import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ApplicationStatus,
  AuditActorType,
  AuditCategory,
  AuditResource,
  Role,
  type Application,
  type Prisma,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { clusterName } from '../agent/utils/cluster-name';
import {
  DOCUMENT_SIGNATURES,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { farmDocumentsSummary } from '../farm/utils/farm-document-summary';
import { FarmService, mapFarmSaveError } from '../farm/services/farm.service';
import { LocationService } from '../location/location.service';
import { MailService } from '../mail/mail.service';
import { applicationPendingEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CompleteApplicationDto } from './dto/complete-application.dto';
import type { SaveApplicationDto } from './dto/save-application.dto';
import { formatApplication } from './formatters/application.formatter';

export interface ApplicationFiles {
  idDocument?: StorageUploadFile;
  ownershipDocument?: StorageUploadFile;
  chiefConfirmation?: StorageUploadFile;
}

/**
 * The form a farmer or extension agent fills after signup. Completing it
 * creates the profile that signup deliberately left out.
 */
@Injectable()
export class ApplicationService {
  private readonly logger = new Logger(ApplicationService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly locations: LocationService,
    private readonly farms: FarmService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async findMine(user: User) {
    return formatApplication(this.storage, await this.requireDraftable(user));
  }

  async save(user: User, dto: SaveApplicationDto, files: ApplicationFiles) {
    const current = await this.requireEditable(user);
    const saved = await this.write(current, dto, files);
    return formatApplication(this.storage, saved);
  }

  async complete(user: User, dto: SaveApplicationDto, files: ApplicationFiles) {
    const current = await this.requireEditable(user);
    const saved = await this.write(current, dto, files);
    const missing = await CompleteApplicationDto.fromApplication(
      user.role,
      saved,
    ).messages();
    if (missing.length > 0) {
      throw new BadRequestException(missing);
    }
    try {
      await this.database.$transaction(async (tx) => {
        const claimed = await tx.application.updateMany({
          where: { id: saved.id, status: ApplicationStatus.DRAFT },
          data: {
            status: ApplicationStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException('Application can no longer be edited');
        }
        const lga = await this.locations.requireLga(
          saved.stateId ?? '',
          saved.lgaId ?? '',
          tx,
        );
        await tx.user.update({
          where: { id: user.id },
          data: {
            phoneNumber: saved.phoneNumber,
            agreedToTerms: true,
          },
        });
        if (user.role === Role.FARMER) {
          await this.createFarmer(tx, user, saved);
        } else {
          await this.createAgent(tx, user, saved, lga.name);
        }
      });
    } catch (error) {
      throw mapFarmSaveError(error);
    }
    await this.mail
      .send(user.email, applicationPendingEmail({ firstName: user.firstName }))
      .catch((error) => {
        this.logger.error(
          `Pending-review email not sent to user ${user.id}`,
          error,
        );
      });
    return formatApplication(
      this.storage,
      await this.database.application.findUniqueOrThrow({
        where: { id: saved.id },
      }),
    );
  }

  private async requireDraftable(user: User): Promise<Application> {
    const application = await this.database.application.findUnique({
      where: { userId: user.id },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }

  private async requireEditable(user: User): Promise<Application> {
    const application = await this.requireDraftable(user);
    if (application.status === ApplicationStatus.COMPLETED) {
      throw new ConflictException('Application can no longer be edited');
    }
    return application;
  }

  private async write(
    current: Application,
    dto: SaveApplicationDto,
    files: ApplicationFiles,
  ): Promise<Application> {
    const stateId = dto.stateId ?? current.stateId ?? undefined;
    const lgaId = dto.lgaId ?? current.lgaId ?? undefined;
    if (dto.stateId !== undefined || dto.lgaId !== undefined) {
      if (!stateId || !lgaId) {
        throw new BadRequestException('State and LGA are both required');
      }
      await this.locations.requireLga(stateId, lgaId);
    }
    const uploaded: string[] = [];
    const upload = async (name: string, file?: StorageUploadFile) => {
      if (!file) {
        return undefined;
      }
      const key = await this.storage.uploadPrivateFile(
        `applications/${current.id}/${name}`,
        file,
        DOCUMENT_SIGNATURES,
      );
      uploaded.push(key);
      return key;
    };
    try {
      const idDocumentKey = await upload('id', files.idDocument);
      const ownershipDocumentKey = await upload(
        'ownership',
        files.ownershipDocument,
      );
      const chiefConfirmationKey = await upload(
        'chief-confirmation',
        files.chiefConfirmation,
      );
      const saved = await this.database.application.update({
        where: { id: current.id },
        data: {
          phoneNumber: dto.phoneNumber,
          agreedToTerms: dto.agreedToTerms,
          idType: dto.idType,
          idNumber: dto.idNumber,
          farmName: dto.farmName,
          stateId: dto.stateId,
          lgaId: dto.lgaId,
          location: dto.location,
          size: dto.size,
          unit: dto.unit,
          mainProduce: dto.mainProduce,
          isExporting: dto.isExporting,
          referralAgentId: dto.referralAgentId,
          idDocumentKey,
          ownershipDocumentKey,
          chiefConfirmationKey,
        },
      });
      await this.storage.deletePrivate([
        idDocumentKey ? current.idDocumentKey : null,
        ownershipDocumentKey ? current.ownershipDocumentKey : null,
        chiefConfirmationKey ? current.chiefConfirmationKey : null,
      ]);
      return saved;
    } catch (error) {
      await this.storage.deletePrivate(uploaded);
      throw error;
    }
  }

  private async createFarmer(
    tx: Prisma.TransactionClient,
    user: User,
    application: Application,
  ): Promise<void> {
    const farmerId = randomUUID();
    const farmId = randomUUID();
    const farmer = await tx.farmer.create({
      data: {
        id: farmerId,
        userId: user.id,
        idType: application.idType,
        idNumber: application.idNumber,
        idDocumentKey: application.idDocumentKey,
      },
    });
    const { farm } = await this.farms.insertFarm(tx, {
      id: farmId,
      ownerId: farmerId,
      name: application.farmName ?? '',
      stateId: application.stateId ?? '',
      lgaId: application.lgaId ?? '',
      location: application.location ?? '',
      size: application.size ?? 0,
      unit: application.unit ?? 'ha',
      mainProduce: application.mainProduce ?? '',
      isExporting: application.isExporting ?? false,
      referralAgentId: application.referralAgentId,
      ownershipDocumentKey: application.ownershipDocumentKey,
      chiefConfirmationKey: application.chiefConfirmationKey,
    });
    const fullName = `${user.firstName} ${user.lastName}`;
    await this.audit.record(tx, {
      actorType: AuditActorType.FARMER,
      farmerId: farmer.id,
      agentId: null,
      farmId: null,
      category: AuditCategory.APPLICATION,
      title: 'Account created',
      summary: `${fullName} (${farmer.farmerId})`,
      actionLabel: 'View profile',
      resource: AuditResource.FARMER,
      resourceId: farmer.id,
    });
    await this.audit.record(tx, {
      actorType: AuditActorType.FARMER,
      farmerId: farmer.id,
      agentId: null,
      farmId: farm.id,
      category: AuditCategory.FARM,
      title: `Farm ${farm.farmCode} created`,
      summary: `${farm.name}, ${farm.mainProduce}`,
      actionLabel: 'View farm',
      resource: AuditResource.FARM,
      resourceId: farm.id,
    });
    if (application.idDocumentKey) {
      await this.audit.record(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: farmer.id,
        agentId: null,
        farmId: null,
        category: AuditCategory.DOCUMENTS,
        title: 'ID document uploaded',
        summary: application.idType ?? 'ID document',
        actionLabel: 'View profile',
        resource: AuditResource.FARMER,
        resourceId: farmer.id,
      });
    }
    const docSummary = farmDocumentsSummary(
      application.ownershipDocumentKey,
      application.chiefConfirmationKey,
    );
    if (docSummary) {
      await this.audit.record(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: farmer.id,
        agentId: null,
        farmId: farm.id,
        category: AuditCategory.DOCUMENTS,
        title: 'Farm documents uploaded',
        summary: docSummary,
        actionLabel: 'View farm',
        resource: AuditResource.FARM,
        resourceId: farm.id,
      });
    }
  }

  private async createAgent(
    tx: Prisma.TransactionClient,
    user: User,
    application: Application,
    lgaName: string,
  ): Promise<void> {
    const stateId = application.stateId ?? '';
    const lgaId = application.lgaId ?? '';
    const agent = await tx.agent.create({
      data: {
        user: { connect: { id: user.id } },
        idType: application.idType,
        idNumber: application.idNumber,
        idDocumentKey: application.idDocumentKey,
        state: { connect: { id: stateId } },
        lga: { connect: { id: lgaId } },
        cluster: { create: { name: clusterName(lgaName) } },
      },
    });
    const fullName = `${user.firstName} ${user.lastName}`;
    await this.audit.record(tx, {
      actorType: AuditActorType.EXTENSION_AGENT,
      farmerId: null,
      agentId: agent.id,
      farmId: null,
      category: AuditCategory.APPLICATION,
      title: 'Account created',
      summary: `${fullName} (${agent.agentId})`,
      actionLabel: 'View profile',
      resource: AuditResource.AGENT,
      resourceId: agent.id,
    });
  }
}
