import { ConfigService } from '@nestjs/config';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  Role,
  type User,
} from '../../../generated/client';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

const caller = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Okafor',
  phoneNumber: '+2348012345678',
} as User;

describe('AuthService profile', () => {
  const user = { update: jest.fn() };
  const farmer = { findUniqueOrThrow: jest.fn() };
  const agent = { findUniqueOrThrow: jest.fn() };
  const tx = { user, farmer, agent };
  const audit = { record: jest.fn() };
  const database = {
    user,
    farmer,
    agent,
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const storage = { uploadPublic: jest.fn() };
  const service = new AuthService(
    database as unknown as PrismaService,
    {} as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    {} as EmailOtpService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('writes only the fields that were sent', async () => {
    const updated = { ...caller, firstName: 'Aminu' };
    user.update.mockResolvedValue(updated);

    await expect(
      service.updateProfile(caller, { firstName: 'Aminu' }),
    ).resolves.toEqual(updated);

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { firstName: 'Aminu' },
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('records the fields a farmer sent', async () => {
    const farmerUser = { ...caller, role: Role.FARMER };
    user.update.mockResolvedValue(farmerUser);
    farmer.findUniqueOrThrow.mockResolvedValue({ id: 'farmer-1' });
    await service.updateProfile(farmerUser, {
      firstName: 'Aminu',
      phoneNumber: '+2348099999999',
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorType: AuditActorType.FARMER,
      farmerId: 'farmer-1',
      agentId: null,
      farmId: null,
      category: AuditCategory.PROFILE,
      title: 'Profile updated',
      summary: 'first name and phone',
      actionLabel: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: 'farmer-1',
    });
  });

  it('records the fields an extension agent sent', async () => {
    const agentUser = { ...caller, role: Role.EXTENSION_AGENT };
    user.update.mockResolvedValue(agentUser);
    agent.findUniqueOrThrow.mockResolvedValue({ id: 'agent-1' });
    await service.updateProfile(agentUser, {
      firstName: 'Aminu',
      lastName: 'Bello',
      phoneNumber: '+2348099999999',
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorType: AuditActorType.EXTENSION_AGENT,
      farmerId: null,
      agentId: 'agent-1',
      farmId: null,
      category: AuditCategory.PROFILE,
      title: 'Profile updated',
      summary: 'first name, last name, and phone',
      actionLabel: 'View profile',
      resource: AuditResource.AGENT,
      resourceId: 'agent-1',
    });
  });

  it('records nothing for a buyer or an empty body', async () => {
    await service.updateProfile(
      { ...caller, role: Role.BUYER },
      {
        firstName: 'Aminu',
      },
    );
    await service.updateProfile({ ...caller, role: Role.FARMER }, {});
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('uploads the avatar to the public bucket and persists the URL', async () => {
    const avatarUrl = 'https://cdn.example.com/users/user-1/x.png';
    storage.uploadPublic.mockResolvedValue(avatarUrl);
    user.update.mockResolvedValue({ ...caller, avatarUrl });

    await expect(service.uploadAvatar(caller, imageFile)).resolves.toEqual({
      ...caller,
      avatarUrl,
    });

    expect(storage.uploadPublic).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/user-1\/.+\.png$/),
      imageFile.buffer,
      'image/png',
    );
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { avatarUrl },
    });
  });
});

const imageFile: StorageUploadFile = {
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
  mimetype: 'image/png',
  size: 10,
};
