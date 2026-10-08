import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '../../../generated/client';
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

// Farmer rows are created with their FARMER user (AuthService.createLocalUser)
// and deleted with it (onDelete: Cascade), so there is no create or delete here.
@Injectable()
export class FarmerService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findMine(user: User): Promise<FarmerProfileDto> {
    const farmer = await this.requireFarmer(user);
    return {
      ...toFarmerDto(farmer),
      ...(await formatIdentity(this.storage, farmer)),
    };
  }

  async updateMine(user: User, dto: UpdateIdentityDto) {
    const farmer = await this.requireFarmer(user);
    await this.database.farmer.update({
      where: { id: farmer.id },
      data: { idType: dto.idType, idNumber: dto.idNumber },
    });
    return this.findMine(user);
  }

  async uploadIdDocument(user: User, file: StorageUploadFile) {
    const farmer = await this.requireFarmer(user);
    await replaceIdDocument(
      this.storage,
      `farmers/${farmer.id}/id`,
      file,
      farmer.idDocumentKey,
      (idDocumentKey) =>
        this.database.farmer.update({
          where: { id: farmer.id },
          data: { idDocumentKey },
        }),
    );
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

  private async requireFarmer(user: User) {
    const farmer = await this.database.farmer.findUnique({
      where: { userId: user.id },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer profile not found');
    }
    return farmer;
  }
}
