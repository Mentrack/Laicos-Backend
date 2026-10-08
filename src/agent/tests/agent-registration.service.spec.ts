import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { FirebaseService } from '../../auth/firebase/firebase.service';
import { DOCUMENT_SIGNATURES } from '../../common/upload-pipes';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { LocationService } from '../../location/location.service';
import { StorageService } from '../../storage/storage.service';
import { AgentRegistrationService } from '../agent-registration.service';
import { AgentService } from '../agent.service';

const pdf: StorageUploadFile = {
  buffer: Buffer.from('%PDF-1.4'),
  mimetype: 'application/pdf',
  size: 8,
};
const fields = {
  phoneNumber: '+2348012345678',
  agreedToTerms: true,
  stateId: 'state-1',
  lgaId: 'lga-1',
  idType: 'NIN' as const,
  idNumber: '12345678901',
};
const signup = {
  ...fields,
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
};
const profile = { id: 'agent-1', agentId: 'AG-000001' };

describe('AgentRegistrationService', () => {
  const storage = { uploadPrivateFile: jest.fn(), deletePrivate: jest.fn() };
  const auth = {
    createFirebaseUser: jest.fn(),
    createLocalUser: jest.fn(),
    deleteFirebaseUser: jest.fn(),
  };
  const firebase = { signInWithGoogle: jest.fn() };
  const locations = { requireLga: jest.fn() };
  const agents = { findMine: jest.fn() };
  const service = new AgentRegistrationService(
    storage as unknown as StorageService,
    auth as unknown as AuthService,
    firebase as unknown as FirebaseService,
    locations as unknown as LocationService,
    agents as unknown as AgentService,
  );
  const user = { id: 'user-1', role: Role.EXTENSION_AGENT };

  beforeEach(() => {
    jest.resetAllMocks();
    auth.createFirebaseUser.mockResolvedValue({ uid: 'uid-1' });
    auth.createLocalUser.mockResolvedValue(user);
    locations.requireLga.mockResolvedValue({ id: 'lga-1', name: 'Gwagwalada' });
    storage.uploadPrivateFile.mockResolvedValue('agents/a/id/x.pdf');
    agents.findMine.mockResolvedValue(profile);
  });

  describe('signUp', () => {
    it('creates a password-less account and the agent with location, ID and cluster', async () => {
      const result = await service.signUp(signup, pdf);

      expect(auth.createFirebaseUser).toHaveBeenCalledWith({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
      });
      expect(locations.requireLga).toHaveBeenCalledWith('state-1', 'lga-1');
      const [[prefix, file, signatures]] = storage.uploadPrivateFile.mock
        .calls as [[string, StorageUploadFile, unknown]];
      expect(file).toBe(pdf);
      expect(signatures).toBe(DOCUMENT_SIGNATURES);
      const agentId = /^agents\/(.+)\/id$/.exec(prefix)?.[1];
      expect(agentId).toBeDefined();
      expect(auth.createLocalUser).toHaveBeenCalledWith({
        firebaseUid: 'uid-1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        phoneNumber: '+2348012345678',
        agreedToTerms: true,
        isVerified: false,
        role: Role.EXTENSION_AGENT,
        agent: {
          id: agentId,
          state: { connect: { id: 'state-1' } },
          lga: { connect: { id: 'lga-1' } },
          idType: 'NIN',
          idNumber: '12345678901',
          idDocumentKey: 'agents/a/id/x.pdf',
          cluster: { create: { name: 'Gwagwalada Hub' } },
        },
      });
      expect(agents.findMine).toHaveBeenCalledWith(user);
      expect(result).toEqual({ user, agent: profile });
    });

    it('checks the LGA before uploading, then deletes the new account', async () => {
      locations.requireLga.mockRejectedValue(
        new BadRequestException('Invalid state or LGA'),
      );
      await expect(service.signUp(signup, pdf)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
      expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('uid-1');
    });

    it('deletes the upload and the account when the write fails', async () => {
      auth.createLocalUser.mockRejectedValue(
        new ConflictException('Account already registered'),
      );
      await expect(service.signUp(signup, pdf)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.deletePrivate).toHaveBeenCalledWith(['agents/a/id/x.pdf']);
      expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('uid-1');
    });
  });

  describe('signUpWithGoogle', () => {
    const dto = { ...fields, idToken: 'google-token' };
    const google = {
      localId: 'google-uid',
      email: 'ada@gmail.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Okafor',
      isNewUser: true,
    };

    it('takes the name and email from Google', async () => {
      firebase.signInWithGoogle.mockResolvedValue(google);
      await service.signUpWithGoogle(dto, pdf);
      expect(auth.createFirebaseUser).not.toHaveBeenCalled();
      expect(auth.createLocalUser).toHaveBeenCalledWith(
        expect.objectContaining({
          firebaseUid: 'google-uid',
          email: 'ada@gmail.com',
          isVerified: true,
          role: Role.EXTENSION_AGENT,
        }),
      );
    });

    it('keeps a Google account it did not create when the write fails', async () => {
      firebase.signInWithGoogle.mockResolvedValue({
        ...google,
        isNewUser: false,
      });
      auth.createLocalUser.mockRejectedValue(
        new ConflictException('Account already registered'),
      );
      await expect(service.signUpWithGoogle(dto, pdf)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.deletePrivate).toHaveBeenCalledWith(['agents/a/id/x.pdf']);
      expect(auth.deleteFirebaseUser).not.toHaveBeenCalled();
    });
  });
});
