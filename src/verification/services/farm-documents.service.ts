import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FarmVerificationStatus, type Prisma } from '../../../generated/client';
import { isRecordNotFound } from '../../common/prisma-errors';
import {
  DOCUMENT_SIGNATURES,
  type StorageUploadFile,
} from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/** The documents an agent checks: the farmer's ID and the farm's papers. */
export interface FarmDocumentUploads {
  idDocument?: StorageUploadFile;
  ownershipDocument?: StorageUploadFile;
  chiefConfirmation?: StorageUploadFile;
}

export interface UploadedFarmDocuments {
  idDocumentKey: string | null;
  ownershipDocumentKey: string | null;
  chiefConfirmationKey: string | null;
  /** Every key stored, for the caller to delete if its write then fails. */
  uploaded: string[];
}

const VERIFIED_FARM_DOCUMENTS = 'A verified farm’s documents cannot change';

/**
 * Stores and replaces a farm's documents. Here rather than in FarmModule
 * because both farmers (their own farm) and agents (on site, during the
 * round) do it, and FarmModule already imports this module.
 */
@Injectable()
export class FarmDocumentsService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Uploads what is given; a failure part-way deletes what it stored. */
  async uploadAll(
    farmerId: string,
    farmId: string,
    documents: FarmDocumentUploads,
  ): Promise<UploadedFarmDocuments> {
    const uploaded: string[] = [];
    const upload = async (prefix: string, file?: StorageUploadFile) => {
      if (!file) {
        return null;
      }
      const key = await this.storage.uploadPrivateFile(
        prefix,
        file,
        DOCUMENT_SIGNATURES,
      );
      uploaded.push(key);
      return key;
    };
    try {
      return {
        idDocumentKey: await upload(
          `farmers/${farmerId}/id`,
          documents.idDocument,
        ),
        ownershipDocumentKey: await upload(
          `farms/${farmId}/ownership`,
          documents.ownershipDocument,
        ),
        chiefConfirmationKey: await upload(
          `farms/${farmId}/chief-confirmation`,
          documents.chiefConfirmation,
        ),
        uploaded,
      };
    } catch (error) {
      await this.storage.deletePrivate(uploaded);
      throw error;
    }
  }

  /**
   * Replaces the documents sent on a farm matching `scope`, then deletes the
   * objects they replace. A VERIFIED farm's documents are what its agent
   * checked, so they are frozen.
   */
  async replace(
    farmId: string,
    scope: Prisma.FarmWhereInput,
    documents: FarmDocumentUploads,
  ): Promise<void> {
    if (
      !documents.idDocument &&
      !documents.ownershipDocument &&
      !documents.chiefConfirmation
    ) {
      throw new BadRequestException('Send at least one document');
    }
    const current = await this.database.farm.findFirst({
      where: { id: farmId, AND: [scope] },
      select: {
        verificationStatus: true,
        ownershipDocumentKey: true,
        chiefConfirmationKey: true,
        owner: { select: { id: true, idDocumentKey: true } },
      },
    });
    if (!current) {
      throw new NotFoundException('Farm not found');
    }
    if (current.verificationStatus === FarmVerificationStatus.VERIFIED) {
      throw new ConflictException(VERIFIED_FARM_DOCUMENTS);
    }

    const { uploaded, ...keys } = await this.uploadAll(
      current.owner.id,
      farmId,
      documents,
    );
    try {
      await this.database.$transaction(async (tx) => {
        // Status guard in the where: an approval landing between the read
        // and this write must not get its documents swapped.
        await tx.farm.update({
          where: {
            id: farmId,
            verificationStatus: { not: FarmVerificationStatus.VERIFIED },
            AND: [scope],
          },
          data: {
            ...(keys.ownershipDocumentKey && {
              ownershipDocumentKey: keys.ownershipDocumentKey,
            }),
            ...(keys.chiefConfirmationKey && {
              chiefConfirmationKey: keys.chiefConfirmationKey,
            }),
          },
        });
        if (keys.idDocumentKey) {
          await tx.farmer.update({
            where: { id: current.owner.id },
            data: { idDocumentKey: keys.idDocumentKey },
          });
        }
      });
    } catch (error) {
      await this.storage.deletePrivate(uploaded);
      throw isRecordNotFound(error)
        ? new ConflictException(VERIFIED_FARM_DOCUMENTS)
        : error;
    }
    await this.storage.deletePrivate([
      keys.idDocumentKey ? current.owner.idDocumentKey : null,
      keys.ownershipDocumentKey ? current.ownershipDocumentKey : null,
      keys.chiefConfirmationKey ? current.chiefConfirmationKey : null,
    ]);
  }
}
