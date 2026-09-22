import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '../../../generated/client';
import {
  PaginationQueryDto,
  paginationMeta,
  resolvePagination,
} from '../../common/pagination';
import {
  isForeignKeyViolation,
  isRecordNotFound,
} from '../../common/prisma-errors';
import { farmOwnedBy } from '../../common/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFarmDto, UpdateFarmDto } from '../dto';

/** Every method is scoped to farms owned by `user`'s Farmer. */
@Injectable()
export class FarmService {
  constructor(private readonly database: PrismaService) {}

  async create(user: User, dto: CreateFarmDto) {
    try {
      return await this.database.farm.create({
        data: {
          name: dto.name,
          location: dto.location,
          size: dto.size,
          unit: dto.unit,
          mainProduce: dto.mainProduce,
          isExporting: dto.isExporting,
          referralAgentId: dto.referralAgentId,
          owner: { connect: { userId: user.id } },
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Farmer profile not found');
      }
      throw error;
    }
  }

  async findAll(user: User, query: PaginationQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = farmOwnedBy(user);
    const [data, total] = await this.database.$transaction([
      this.database.farm.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.farm.count({ where }),
    ]);
    return { data, metaData: paginationMeta(page, perPage, total) };
  }

  async findOne(user: User, id: string) {
    const farm = await this.database.farm.findFirst({
      where: { id, ...farmOwnedBy(user) },
    });
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    return farm;
  }

  async update(user: User, id: string, dto: UpdateFarmDto) {
    try {
      return await this.database.farm.update({
        where: { id, ...farmOwnedBy(user) },
        data: {
          name: dto.name,
          location: dto.location,
          size: dto.size,
          unit: dto.unit,
          mainProduce: dto.mainProduce,
          isExporting: dto.isExporting,
          referralAgentId: dto.referralAgentId,
        },
      });
    } catch (error) {
      throw mapFarmWriteError(error);
    }
  }

  async remove(user: User, id: string) {
    try {
      return await this.database.farm.delete({
        where: { id, ...farmOwnedBy(user) },
      });
    } catch (error) {
      throw mapFarmWriteError(error);
    }
  }
}

// Another farmer's farm reads as not found, so ids can't be probed for existence.
function mapFarmWriteError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new NotFoundException('Farm not found');
  }
  if (isForeignKeyViolation(error)) {
    return new ConflictException('Farm has orders and cannot be deleted');
  }
  return error;
}
