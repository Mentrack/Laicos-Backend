import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Role } from '../../generated/client';
import { AuthService } from '../auth/auth.service';
import type { CreateLocalUserDto } from '../auth/dto';
import { FirebaseService } from '../auth/firebase/firebase.service';
import type { UpdateIdentityDto } from '../common/dto/identity.dto';
import {
  DOCUMENT_SIGNATURES,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { LocationService } from '../location/location.service';
import { StorageService } from '../storage/storage.service';
import { AgentService } from './agent.service';
import type {
  AgentSignupDto,
  GoogleAgentSignupDto,
  RegisteredAgentDto,
} from './dto';
import { clusterName } from './utils/cluster-name';

interface AgentRegistration {
  /** `isNew`: this request created it, so a failure deletes it. */
  account: { uid: string; isNew: boolean };
  user: Pick<
    CreateLocalUserDto,
    'email' | 'firstName' | 'lastName' | 'phoneNumber' | 'isVerified'
  > & { agreedToTerms: boolean };
  identity: UpdateIdentityDto;
  stateId: string;
  lgaId: string;
  idDocument: StorageUploadFile;
}

/**
 * Creates an extension agent from self-signup (email or Google). No password
 * is set and `activatedAt` stays null, so the agent is locked out until an
 * admin verifies them.
 */
@Injectable()
export class AgentRegistrationService {
  constructor(
    private readonly storage: StorageService,
    private readonly auth: AuthService,
    private readonly firebase: FirebaseService,
    private readonly locations: LocationService,
    private readonly agents: AgentService,
  ) {}

  async signUp(dto: AgentSignupDto, idDocument: StorageUploadFile) {
    const account = await this.auth.createFirebaseUser({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    return this.register({
      account: { uid: account.uid, isNew: true },
      user: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        agreedToTerms: dto.agreedToTerms,
        isVerified: false,
      },
      identity: { idType: dto.idType, idNumber: dto.idNumber },
      stateId: dto.stateId,
      lgaId: dto.lgaId,
      idDocument,
    });
  }

  async signUpWithGoogle(
    dto: GoogleAgentSignupDto,
    idDocument: StorageUploadFile,
  ) {
    const google = await this.firebase.signInWithGoogle(dto.idToken);
    return this.register({
      account: { uid: google.localId, isNew: google.isNewUser },
      user: {
        email: google.email,
        firstName: google.firstName,
        lastName: google.lastName,
        phoneNumber: dto.phoneNumber,
        agreedToTerms: dto.agreedToTerms,
        isVerified: google.emailVerified,
      },
      identity: { idType: dto.idType, idNumber: dto.idNumber },
      stateId: dto.stateId,
      lgaId: dto.lgaId,
      idDocument,
    });
  }

  /**
   * Everything after the Firebase account exists. Any failure deletes the
   * upload and, if this request created it, the account.
   */
  private async register(
    input: AgentRegistration,
  ): Promise<RegisteredAgentDto> {
    // Drawn here so the ID document is stored under its final key.
    const agentId = randomUUID();
    let idDocumentKey: string | null = null;
    let user: Awaited<ReturnType<AuthService['createLocalUser']>>;
    try {
      const lga = await this.locations.requireLga(input.stateId, input.lgaId);
      idDocumentKey = await this.storage.uploadPrivateFile(
        `agents/${agentId}/id`,
        input.idDocument,
        DOCUMENT_SIGNATURES,
      );
      user = await this.auth.createLocalUser({
        firebaseUid: input.account.uid,
        ...input.user,
        role: Role.EXTENSION_AGENT,
        agent: {
          id: agentId,
          state: { connect: { id: input.stateId } },
          lga: { connect: { id: input.lgaId } },
          idType: input.identity.idType,
          idNumber: input.identity.idNumber,
          idDocumentKey,
          cluster: { create: { name: clusterName(lga.name) } },
        },
      });
    } catch (error) {
      await this.storage.deletePrivate([idDocumentKey]);
      if (input.account.isNew) {
        await this.auth.deleteFirebaseUser(input.account.uid);
      }
      throw error;
    }
    // Outside the try: the agent is committed, so nothing is undone if
    // only this read fails.
    return { user, agent: await this.agents.findMine(user) };
  }
}
