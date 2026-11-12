import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  Prisma,
} from '../../generated/client';
import { fullName } from '../common/names';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventDto } from './dto/audit-event.dto';
import { AuditQueryDto } from './dto/audit-query.dto';

const withActor = {
  actorUser: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} satisfies Prisma.AuditEventInclude;

type AuditRow = Prisma.AuditEventGetPayload<{ include: typeof withActor }>;

export type AuditActor = {
  type: AuditActorType;
  /** The acting User.id; null only for SYSTEM. */
  userId: string | null;
};

export interface AuditWrite {
  actorType: AuditActorType;
  /** The acting User.id, never a profile id. Null only for SYSTEM. */
  actorUserId: string | null;
  farmerId: string | null;
  agentId: string | null;
  farmId: string | null;
  category: AuditCategory;
  title: string;
  summary: string;
  actionLabel: string | null;
  resource: AuditResource | null;
  resourceId: string | null;
  sourcingRequestId?: string | null;
  orderId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: PrismaService) {}

  async record(tx: Prisma.TransactionClient, event: AuditWrite): Promise<void> {
    await tx.auditEvent.create({
      data: {
        ...event,
        sourcingRequestId: event.sourcingRequestId ?? null,
        orderId: event.orderId ?? null,
      },
    });
  }

  async findForFarmer(farmerId: string, query: AuditQueryDto) {
    const farmer = await this.database.farmer.findUnique({
      where: { id: farmerId },
      select: { id: true },
    });
    if (!farmer) {
      throw new NotFoundException('Farmer not found');
    }

    const where: Prisma.AuditEventWhereInput = { farmerId };
    if (query.farmId) {
      const farm = await this.database.farm.findFirst({
        where: { id: query.farmId, ownerId: farmerId },
        select: { id: true },
      });
      if (!farm) {
        throw new NotFoundException('Farm not found');
      }
      where.farmId = query.farmId;
    }

    return this.list(where, query);
  }

  async findForAgent(agentId: string, query: AuditQueryDto) {
    const agent = await this.database.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    const where: Prisma.AuditEventWhereInput = { agentId };
    if (query.farmId) {
      const farm = await this.database.farm.findUnique({
        where: { id: query.farmId },
        select: { id: true },
      });
      if (!farm) {
        throw new NotFoundException('Farm not found');
      }
      where.farmId = query.farmId;
    }

    return this.list(where, query);
  }

  async findForRequest(sourcingRequestId: string, query: AuditQueryDto) {
    const request = await this.database.sourcingRequest.findUnique({
      where: { id: sourcingRequestId },
      select: { id: true },
    });
    if (!request) {
      throw new NotFoundException('Sourcing request not found');
    }
    return this.list({ sourcingRequestId }, query);
  }

  async findForOrder(orderId: string, query: AuditQueryDto) {
    const order = await this.database.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.list({ orderId }, query);
  }

  private async list(
    where: Prisma.AuditEventWhereInput,
    query: AuditQueryDto,
  ): Promise<{
    data: AuditEventDto[];
    metaData: ReturnType<typeof paginationMeta>;
  }> {
    const { page, perPage, skip, take } = resolvePagination(query);
    const orderBy: Prisma.AuditEventOrderByWithRelationInput[] = [
      { occurredAt: 'desc' },
      { id: 'desc' },
    ];
    const [rows, total] = await Promise.all([
      this.database.auditEvent.findMany({
        where,
        orderBy,
        skip,
        take,
        include: withActor,
      }),
      this.database.auditEvent.count({ where }),
    ]);
    return {
      data: rows.map(formatAuditEvent),
      metaData: paginationMeta(page, perPage, total),
    };
  }
}

function formatAuditEvent(row: AuditRow): AuditEventDto {
  const action =
    row.actionLabel && row.resource && row.resourceId
      ? {
          label: row.actionLabel,
          resource: row.resource,
          resourceId: row.resourceId,
        }
      : null;
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    category: row.category,
    title: row.title,
    summary: row.summary,
    action,
    actorType: row.actorType,
    actor: row.actorUser
      ? {
          id: row.actorUser.id,
          name: fullName(row.actorUser),
          role: row.actorUser.role,
        }
      : null,
  };
}
