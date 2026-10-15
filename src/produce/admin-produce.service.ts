import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProduceStatus } from '../../generated/client';
import { paginationMeta, resolvePagination } from '../common/pagination';
import {
  isForeignKeyViolation,
  isRecordNotFound,
} from '../common/prisma-errors';
import { OPEN_PAID_ORDER_STATUSES } from '../order/utils/open-paid';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminProduceActionDto,
  AdminProduceQueryDto,
  AdminProduceRowDto,
  AdminProduceSummaryDto,
} from './dto/admin-produce.dto';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const ACTIVE = [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT];
const INACTIVE = [ProduceStatus.DRAFT, ProduceStatus.DISABLED];

const LIST_INCLUDE = {
  farm: { select: { id: true, farmCode: true } },
} satisfies Prisma.ProduceInclude;

type Listed = Prisma.ProduceGetPayload<{ include: typeof LIST_INCLUDE }>;

@Injectable()
export class AdminProduceService {
  constructor(private readonly database: PrismaService) {}

  async findAll(query: AdminProduceQueryDto) {
    return this.list(query);
  }

  async findByFarm(farmId: string, query: AdminProduceQueryDto) {
    const farm = await this.database.farm.findUnique({
      where: { id: farmId },
      select: { id: true },
    });
    if (!farm) {
      throw new NotFoundException('Farm not found');
    }
    return this.list(query, farmId);
  }

  private async list(query: AdminProduceQueryDto, farmId?: string) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = { ...whereFor(query), farmId };
    const [rows, total] = await this.database.$transaction([
      this.database.produce.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.database.produce.count({ where }),
    ]);
    return {
      data: rows.map(toRow),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async summary(): Promise<AdminProduceSummaryDto> {
    const since = new Date(Date.now() - WEEK_MS);
    const [
      totalProducts,
      statuses,
      categories,
      farms,
      stockRows,
      activeClusters,
      recentListings,
    ] = await Promise.all([
      this.database.produce.count(),
      this.database.produce.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.database.produce.groupBy({
        by: ['category'],
        where: { category: { not: null } },
        _count: { _all: true },
      }),
      this.database.produce.groupBy({ by: ['farmId'] }),
      // Units are free text, so only kilograms can be added into one figure.
      this.database.$queryRaw<{ sum: number }[]>`
        SELECT COALESCE(SUM("floatingQuantity"), 0)::int AS sum
        FROM "Produce"
        WHERE lower(btrim(unit)) = 'kg'
      `,
      this.database.cluster.count({
        where: { farms: { some: { produce: { some: {} } } } },
      }),
      this.database.produce.count({ where: { createdAt: { gte: since } } }),
    ]);
    const byStatus = {
      [ProduceStatus.DRAFT]: 0,
      [ProduceStatus.PUBLISHED]: 0,
      [ProduceStatus.SOLD_OUT]: 0,
      [ProduceStatus.DISABLED]: 0,
    };
    for (const group of statuses) {
      byStatus[group.status] = group._count._all;
    }
    return {
      totalProducts,
      categoryCount: categories.length,
      participatingFarms: farms.length,
      activeListings: ACTIVE.reduce((sum, status) => sum + byStatus[status], 0),
      inactiveListings: INACTIVE.reduce(
        (sum, status) => sum + byStatus[status],
        0,
      ),
      availableStockKg: Number(stockRows[0]?.sum ?? 0),
      activeClusters,
      recentListings,
    };
  }

  async disable(id: string): Promise<AdminProduceActionDto> {
    return this.database.$transaction(async (tx) => {
      const listing = await tx.produce.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!listing) {
        throw new NotFoundException('Produce not found');
      }
      const openPaid = await tx.order.count({
        where: { produceId: id, status: { in: OPEN_PAID_ORDER_STATUSES } },
      });
      if (openPaid > 0) {
        throw new ConflictException('Produce has open paid orders');
      }
      await tx.produce.update({
        where: { id },
        data: { status: ProduceStatus.DISABLED },
      });
      return { id, status: ProduceStatus.DISABLED };
    });
  }

  async remove(id: string): Promise<AdminProduceActionDto> {
    const listing = await this.database.produce.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!listing) {
      throw new NotFoundException('Produce not found');
    }
    if (listing.status !== ProduceStatus.DISABLED) {
      throw new ConflictException('Disable the listing before removing it');
    }
    try {
      await this.database.produce.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException('Produce has orders and cannot be deleted');
      }
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Produce not found');
      }
      throw error;
    }
    return { id, status: ProduceStatus.DISABLED };
  }
}

function whereFor(query: AdminProduceQueryDto): Prisma.ProduceWhereInput {
  const search = query.search?.trim();
  const contains: Prisma.StringFilter = {
    contains: search ?? '',
    mode: 'insensitive',
  };
  return {
    category: query.category,
    status: query.status,
    OR: search
      ? [
          { name: contains },
          { farm: { name: contains } },
          { farm: { farmCode: contains } },
        ]
      : undefined,
  };
}

function toRow(produce: Listed): AdminProduceRowDto {
  return {
    id: produce.id,
    name: produce.name,
    farmId: produce.farmId,
    farmCode: produce.farm.farmCode,
    category: produce.category,
    pricePerUnit: produce.pricePerUnit.toFixed(2),
    unit: produce.unit,
    floatingQuantity: produce.floatingQuantity,
    status: produce.status,
    createdAt: produce.createdAt,
  };
}
