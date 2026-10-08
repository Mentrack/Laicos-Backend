import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Role, type Prisma } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import type { CreateLocalUserDto } from '../../auth/dto';
import { FirebaseService } from '../../auth/firebase/firebase.service';
import type { UpdateIdentityDto } from '../../common/dto/identity.dto';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  FarmDocumentsService,
  type FarmDocumentUploads,
} from '../../verification/services/farm-documents.service';
import type {
  CreateFarmDto,
  FarmerSignupDto,
  GoogleFarmerSignupDto,
  RegisteredFarmerDto,
} from '../dto';
import { formatFarm } from '../formatters/farm.formatter';
import { toFarmerDto } from '../formatters/farmer.formatter';
import { FarmService, mapFarmSaveError } from './farm.service';

export interface FarmerRegistration {
  /** `isNew`: this request created it, so a failure deletes it. */
  account: { uid: string; isNew: boolean };
  user: Pick<
    CreateLocalUserDto,
    'email' | 'firstName' | 'lastName' | 'phoneNumber' | 'isVerified'
  > & { agreedToTerms?: boolean };
  identity?: UpdateIdentityDto;
  farm: Pick<
    CreateFarmDto,
    | 'name'
    | 'stateId'
    | 'lgaId'
    | 'location'
    | 'size'
    | 'unit'
    | 'mainProduce'
    | 'isExporting'
    | 'referralAgentId'
  >;
  documents: FarmDocumentUploads;
  preferredAgentId?: string;
}

/**
 * Creates a farmer with their first farm: self-signup (email or Google) and
 * agent onboarding. No password is set; the farmer gets one in the invite
 * sent when the farm is verified (FarmerActivationService).
 */
@Injectable()
export class FarmerRegistrationService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly auth: AuthService,
    private readonly firebase: FirebaseService,
    private readonly farms: FarmService,
    private readonly documents: FarmDocumentsService,
    private readonly locations: LocationService,
  ) {}

  async signUp(dto: FarmerSignupDto, documents: FarmDocumentUploads) {
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
      farm: farmFields(dto),
      documents,
    });
  }

  async signUpWithGoogle(
    dto: GoogleFarmerSignupDto,
    documents: FarmDocumentUploads,
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
      farm: farmFields(dto),
      documents,
    });
  }

  /**
   * Everything after the Firebase account exists. Any failure deletes the
   * uploads and, if this request created it, the account.
   */
  async register(input: FarmerRegistration): Promise<RegisteredFarmerDto> {
    // Drawn here so the documents are stored under their final keys.
    const farmerId = randomUUID();
    const farmId = randomUUID();
    let uploaded: string[] = [];
    try {
      await this.locations.requireLga(input.farm.stateId, input.farm.lgaId);
      const { uploaded: keys, ...stored } = await this.documents.uploadAll(
        farmerId,
        farmId,
        input.documents,
      );
      uploaded = keys;
      const created = await this.database.$transaction(async (tx) => {
        const user = await this.auth.createLocalUser(
          {
            firebaseUid: input.account.uid,
            ...input.user,
            role: Role.FARMER,
            farmer: {
              id: farmerId,
              idType: input.identity?.idType,
              idNumber: input.identity?.idNumber,
              idDocumentKey: stored.idDocumentKey,
            },
          },
          tx,
        );
        const farmer = await tx.farmer.findUniqueOrThrow({
          where: { id: farmerId },
        });
        const farm = await this.farms.insertFarm(
          tx,
          {
            ...input.farm,
            id: farmId,
            ownerId: farmerId,
            ownershipDocumentKey: stored.ownershipDocumentKey,
            chiefConfirmationKey: stored.chiefConfirmationKey,
          } satisfies Prisma.FarmUncheckedCreateInput,
          input.preferredAgentId,
        );
        return { user, farmer, farm };
      });
      return {
        user: created.user,
        farmer: toFarmerDto(created.farmer),
        farm: await formatFarm(this.storage, created.farm),
      };
    } catch (error) {
      await this.storage.deletePrivate(uploaded);
      if (input.account.isNew) {
        await this.auth.deleteFirebaseUser(input.account.uid);
      }
      throw mapFarmSaveError(error);
    }
  }
}

function farmFields(dto: CreateFarmDto): FarmerRegistration['farm'] {
  return {
    name: dto.name,
    stateId: dto.stateId,
    lgaId: dto.lgaId,
    location: dto.location,
    size: dto.size,
    unit: dto.unit,
    mainProduce: dto.mainProduce,
    isExporting: dto.isExporting,
    referralAgentId: dto.referralAgentId,
  };
}
