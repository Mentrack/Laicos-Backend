import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HandoverStatus,
  OrderStatus,
  type Agent,
  type Prisma,
} from '../../generated/client';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { isRecordNotFound } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompleteHandoverDto,
  HandoverQueryDto,
  VerifyHandoverDto,
} from './dto';
import {
  HANDOVER_INCLUDE,
  formatHandover,
} from './formatters/handover.formatter';

/**
 * An agent's work on READY orders from their cluster: verify the goods, then
 * hand them to logistics. Scoped to the calling agent, so another agent's
 * handover reads as not found.
 */
@Injectable()
export class HandoverService {
  constructor(private readonly database: PrismaService) {}

  async findAll(agent: Agent, query: HandoverQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.OrderHandoverWhereInput = {
      agentId: agent.id,
      status: query.status,
    };
    const [rows, total] = await this.database.$transaction([
      this.database.orderHandover.findMany({
        where,
        include: HANDOVER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.orderHandover.count({ where }),
    ]);
    return {
      data: rows.map(formatHandover),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(agent: Agent, orderId: string) {
    const handover = await this.database.orderHandover.findFirst({
      where: { orderId, agentId: agent.id },
      include: HANDOVER_INCLUDE,
    });
    if (!handover) {
      throw new NotFoundException('Handover not found');
    }
    return formatHandover(handover);
  }

  /** The agent has checked the goods at the farm against the order. */
  async verify(agent: Agent, orderId: string, dto: VerifyHandoverDto) {
    // Guarded on PENDING by the write itself, so a double tap is a 409, not
    // a second verifiedAt.
    const { count } = await this.database.orderHandover.updateMany({
      where: { orderId, agentId: agent.id, status: HandoverStatus.PENDING },
      data: {
        status: HandoverStatus.VERIFIED,
        verificationNote: dto.note ?? null,
        verifiedAt: new Date(),
      },
    });
    if (!count) {
      await this.refuse(
        agent,
        orderId,
        'Only a pending handover can be verified',
      );
    }
    return this.findOne(agent, orderId);
  }

  /** Logistics has the goods: the order ships. */
  async complete(agent: Agent, orderId: string, dto: CompleteHandoverDto) {
    try {
      await this.database.$transaction(async (tx) => {
        const { count } = await tx.orderHandover.updateMany({
          where: {
            orderId,
            agentId: agent.id,
            status: HandoverStatus.VERIFIED,
          },
          data: {
            status: HandoverStatus.HANDED_OVER,
            recipientName: dto.recipientName,
            recipientPhone: dto.recipientPhone ?? null,
            handoverNote: dto.note ?? null,
            handedOverAt: new Date(),
          },
        });
        if (!count) {
          await this.refuse(
            agent,
            orderId,
            'Verify the order before handing it over',
          );
        }
        // Nothing moves a READY order but this, so a miss means data drift;
        // it rolls the handover back rather than ship out of order.
        await tx.order.update({
          where: { id: orderId, status: OrderStatus.READY },
          data: { status: OrderStatus.SHIPPED },
        });
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new ConflictException('Order is no longer ready for handover');
      }
      throw error;
    }
    return this.findOne(agent, orderId);
  }

  /** After a guarded write missed: 404 if not the agent's, else 409. */
  private async refuse(
    agent: Agent,
    orderId: string,
    message: string,
  ): Promise<never> {
    const handover = await this.database.orderHandover.findFirst({
      where: { orderId, agentId: agent.id },
      select: { status: true },
    });
    if (!handover) {
      throw new NotFoundException('Handover not found');
    }
    throw new ConflictException(`${message}; this one is ${handover.status}`);
  }
}
