import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, ProduceStatus, type User } from '../../generated/client';
import { farmOwnedBy } from '../common/ownership';
import { paginationMeta, resolvePagination } from '../common/pagination';
import {
  isForeignKeyViolation,
  isRecordNotFound,
} from '../common/prisma-errors';
import { IMAGE_SIGNATURES, matchSignature } from '../common/upload-pipes';
import type { StorageUploadFile } from '../common/upload-pipes';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateProduceDto, ProduceQueryDto, UpdateProduceDto } from './dto';
import { deriveProduceStatus } from './utils/produce-status';

/** Writes are scoped to the owning farmer; reads hide other farmers' drafts. */
@Injectable()
export class ProduceService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(user: User, dto: CreateProduceDto, file: StorageUploadFile) {
    const farm = await this.database.farm.findFirst({
      where: { id: dto.farmId, ...farmOwnedBy(user) },
      select: { id: true },
    });
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    // actualQuantity and floatingQuantity both start equal to the listed
    // quantity; quantity itself never changes after this.
    const { actualQuantity } = dto;
    const status = deriveProduceStatus(dto.status ?? ProduceStatus.DRAFT, {
      actualQuantity,
      floatingQuantity: actualQuantity,
    });
    // The id is drawn here rather than by the database so the photo can be
    // stored under the row's final key. Uploading has to come first to have a
    // URL to persist, so a create that fails after it — past the ownership
    // check, only a race with the farm being deleted — leaves the object
    // orphaned rather than the listing photo-less.
    const id = randomUUID();
    const imageUrl = await this.uploadImage(id, file);
    return this.database.produce.create({
      data: {
        ...dto,
        id,
        quantity: actualQuantity,
        floatingQuantity: actualQuantity,
        status,
        imageUrl,
      },
    });
  }

  async attachImage(user: User, id: string, file: StorageUploadFile) {
    const current = await this.database.produce.findFirst({
      where: { id, farm: farmOwnedBy(user) },
      select: { id: true },
    });
    if (!current) {
      throw new NotFoundException('Produce not found');
    }
    const imageUrl = await this.uploadImage(id, file);
    try {
      // Scoped by ownership like update()/remove(), even though the
      // findFirst above already checked it: if the produce is deleted
      // between that check and this write (a race with another request),
      // Prisma throws P2025, which mapProduceWriteError turns into a 404
      // instead of an unhandled 500.
      return await this.database.produce.update({
        where: { id, farm: farmOwnedBy(user) },
        data: { imageUrl },
      });
    } catch (error) {
      throw mapProduceWriteError(error);
    }
  }

  async findAll(user: User, query: ProduceQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.ProduceWhereInput = {
      ...visibleTo(user),
      status: query.status,
      type: query.type,
      farmId: query.farmId,
    };
    const [data, total] = await this.database.$transaction([
      this.database.produce.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.produce.count({ where }),
    ]);
    return { data, metaData: paginationMeta(page, perPage, total) };
  }

  async findOne(user: User, id: string) {
    const produce = await this.database.produce.findFirst({
      where: { id, ...visibleTo(user) },
    });
    if (!produce) {
      throw new NotFoundException('Produce not found');
    }
    return produce;
  }

  async update(user: User, id: string, dto: UpdateProduceDto) {
    const current = await this.database.produce.findFirst({
      where: { id, farm: farmOwnedBy(user) },
    });
    if (!current) {
      throw new NotFoundException('Produce not found');
    }

    const actualQuantity = dto.actualQuantity ?? current.actualQuantity;
    const delta = actualQuantity - current.actualQuantity;
    const floatingQuantity = current.floatingQuantity + delta;
    if (floatingQuantity < 0) {
      const reserved = current.actualQuantity - current.floatingQuantity;
      throw new ConflictException(
        `${reserved} ${current.unit} is reserved by pending orders`,
      );
    }
    const status = deriveProduceStatus(dto.status ?? current.status, {
      actualQuantity,
      floatingQuantity,
    });

    try {
      // Guarding on the values just read makes a concurrent order or
      // confirmation fail this write instead of skewing the stock.
      return await this.database.produce.update({
        where: {
          id,
          actualQuantity: current.actualQuantity,
          floatingQuantity: current.floatingQuantity,
        },
        data: { ...dto, actualQuantity, floatingQuantity, status },
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new ConflictException('Produce stock changed; retry');
      }
      throw error;
    }
  }

  async remove(user: User, id: string) {
    try {
      return await this.database.produce.delete({
        where: { id, farm: farmOwnedBy(user) },
      });
    } catch (error) {
      throw mapProduceWriteError(error);
    }
  }

  private uploadImage(
    produceId: string,
    file: StorageUploadFile,
  ): Promise<string> {
    const { contentType, extension } = matchSignature(IMAGE_SIGNATURES, file);
    return this.storage.uploadPublic(
      `produce/${produceId}/${randomUUID()}.${extension}`,
      file.buffer,
      contentType,
    );
  }
}

// Drafts are private to their farmer; everything else is a public listing.
function visibleTo(user: User): Prisma.ProduceWhereInput {
  return {
    OR: [{ status: { not: ProduceStatus.DRAFT } }, { farm: farmOwnedBy(user) }],
  };
}

function mapProduceWriteError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new NotFoundException('Produce not found');
  }
  if (isForeignKeyViolation(error)) {
    return new ConflictException('Produce has orders and cannot be deleted');
  }
  return error;
}
