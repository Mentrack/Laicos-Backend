import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { UpdateIdentityDto } from '../../common/dto/identity.dto';
import { formatIdentity, replaceIdDocument } from '../../common/identity';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../../common/pagination';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { FarmerProfileDto } from '../dto';
import { toFarmerDto } from '../formatters/farmer.formatter';
import { requireFarmer } from '../utils/require-farmer';
import { refreshFarmerEvidenceStatus } from '../../verification/utils/evidence-status';

// Farmer rows are created with their FARMER user (AuthService.createLocalUser)
// and deleted with it (onDelete: Cascade), so there is no create or delete here.
@Injectable()
export class FarmerService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async findMine(user: User): Promise<FarmerProfileDto> {
    const farmer = await requireFarmer(this.database, user);
    return {
      ...toFarmerDto(farmer),
      ...(await formatIdentity(this.storage, farmer)),
    };
  }

  async updateMine(user: User, dto: UpdateIdentityDto) {
    const farmer = await requireFarmer(this.database, user);
    await this.database.$transaction(async (tx) => {
      await tx.farmer.update({
        where: { id: farmer.id },
        data: { idType: dto.idType, idNumber: dto.idNumber },
      });
      await this.audit.record(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: farmer.id,
        agentId: null,
        farmId: null,
        category: AuditCategory.PROFILE,
        title: 'Profile updated',
        summary: 'ID details',
        actionLabel: 'View profile',
        resource: AuditResource.FARMER,
        resourceId: farmer.id,
      });
    });
    return this.findMine(user);
  }

  async uploadIdDocument(user: User, file: StorageUploadFile) {
    const farmer = await requireFarmer(this.database, user);
    await this.database.$transaction(async (tx) => {
      await replaceIdDocument(
        this.storage,
        `farmers/${farmer.id}/id`,
        file,
        farmer.idDocumentKey,
        async (idDocumentKey) => {
          await tx.farmer.update({
            where: { id: farmer.id },
            data: { idDocumentKey },
          });
          await this.audit.record(tx, {
            actorType: AuditActorType.FARMER,
            farmerId: farmer.id,
            agentId: null,
            farmId: null,
            category: AuditCategory.DOCUMENTS,
            title: 'ID document uploaded',
            summary: farmer.idType ?? 'ID document',
            actionLabel: 'View profile',
            resource: AuditResource.FARMER,
            resourceId: farmer.id,
          });
        },
      );
    });
    await refreshFarmerEvidenceStatus(this.database, farmer.id);
    return this.findMine(user);
  }

  async findOne(id: string) {
    const farmer = await this.database.farmer.findUnique({
      where: { id },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer not found');
    }
    return toFarmerDto(farmer);
  }

  async findAll(query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const [farmers, total] = await this.database.$transaction([
      this.database.farmer.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.farmer.count(),
    ]);
    return {
      data: farmers.map(toFarmerDto),
      metaData: paginationMeta(page, perPage, total),
    };
  }
}
