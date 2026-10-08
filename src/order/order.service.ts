import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  Role,
  type Order,
  type User,
} from '../../generated/client';
import { formatCheckout } from '../cart/formatters/checkout.formatter';
import { lockCart } from '../cart/utils/cart-lock';
import {
  createCheckout,
  findReplay,
  resolveDelivery,
} from '../cart/utils/place-checkout';
import { farmOwnedBy } from '../common/ownership';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { isRecordNotFound } from '../common/prisma-errors';
import { CheckoutConfig } from '../payment/checkout-config';
import { PrismaService } from '../prisma/prisma.service';
import { deriveProduceStatus } from '../produce/utils/produce-status';
import { orderLine, reserveProduce } from './utils/reservation';
import {
  CancelOrderDto,
  CreateOrderDto,
  OrderFilterDto,
  OrderQueryDto,
  UpdateOrderChecklistDto,
} from './dto';

// Orders not yet delivered or cancelled.
const ACTIVE: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SHIPPED,
];

// Farmer-cancellable statuses (anything before the hand-over for pickup);
// buyers may only ever cancel a PENDING order.
const SELLER_CANCELLABLE: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
];

// Every item must be ticked before an order can be marked READY.
const CHECKLIST_ITEMS = [
  'harvested',
  'sorted',
  'packaged',
  'readyForPickup',
] as const;
const CHECKLIST_COMPLETE: Prisma.OrderChecklistWhereInput = Object.fromEntries(
  CHECKLIST_ITEMS.map((item) => [item, true]),
);

/**
 * Buyers see the orders they placed, farmers the orders on their farms, and
 * admins everything.
 *
 * Stock: placing an order takes its quantity off the produce's
 * floatingQuantity, confirming takes it off actualQuantity, and cancelling
 * gives back whatever the order had taken. Produce.status tracks whichever
 * of those hits zero and flips back once stock is returned.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: CheckoutConfig,
  ) {}

  /** Buy Now: a one-line checkout that leaves the cart alone. */
  create(user: User, idempotencyKey: string, dto: CreateOrderDto) {
    return this.database.$transaction(async (tx) => {
      // The cart's lock, so Buy Now and cart checkout share one replay check.
      await lockCart(tx, user.id);
      const replay = await findReplay(tx, user.id, idempotencyKey);
      if (replay) {
        return formatCheckout(replay);
      }
      const delivery = await resolveDelivery(
        tx,
        user.id,
        dto.addressId,
        dto.deliveryDate,
        this.config,
      );
      const produce = await reserveProduce(tx, dto.produceId, dto.quantity);
      const checkout = await createCheckout(
        tx,
        {
          buyerId: user.id,
          idempotencyKey,
          lines: [orderLine(produce, dto.quantity)],
          delivery,
          expectedTotal: dto.expectedTotal,
        },
        this.config,
      );
      return formatCheckout(checkout);
    });
  }

  async findAll(user: User, query: OrderQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where = filtered(user, query);
    const [data, total] = await this.database.$transaction([
      this.database.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.order.count({ where }),
    ]);
    return { data, metaData: paginationMeta(page, perPage, total) };
  }

  async count(user: User, filter: OrderFilterDto) {
    const groups = await this.database.order.groupBy({
      by: ['status'],
      where: filtered(user, filter),
      _count: { _all: true },
    });
    // Every status is listed so the client gets zeros rather than missing keys.
    const byStatus: Record<OrderStatus, number> = {
      AWAITING_PAYMENT: 0,
      PENDING: 0,
      CONFIRMED: 0,
      PREPARING: 0,
      READY: 0,
      SHIPPED: 0,
      FULFILLED: 0,
      CANCELLED: 0,
    };
    let total = 0;
    for (const group of groups) {
      byStatus[group.status] = group._count._all;
      total += group._count._all;
    }
    return { total, byStatus };
  }

  // Until payments land there is no ledger, so earnings are simply what
  // delivered orders were worth; they only ever go up.
  async summary(user: User) {
    const where = scopedTo(user);
    const [earned, activeOrders] = await this.database.$transaction([
      this.database.order.aggregate({
        where: { ...where, status: OrderStatus.FULFILLED },
        _sum: { totalPrice: true },
      }),
      this.database.order.count({
        where: { ...where, status: { in: ACTIVE } },
      }),
    ]);
    const totalEarnings = earned._sum.totalPrice ?? new Prisma.Decimal(0);
    return { totalEarnings: totalEarnings.toFixed(2), activeOrders };
  }

  async findOne(user: User, id: string) {
    const order = await this.database.order.findFirst({
      where: { id, ...scopedTo(user) },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async confirm(user: User, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Only a pending order can be confirmed; this one is ${order.status}`,
      );
    }
    try {
      return await this.database.$transaction(async (tx) => {
        const confirmed = await tx.order.update({
          where: { id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.CONFIRMED },
        });
        const produce = await tx.produce.findUniqueOrThrow({
          where: { id: order.produceId },
        });
        await tx.produce.update({
          where: { id: produce.id },
          data: {
            actualQuantity: { decrement: order.quantity },
            status: deriveProduceStatus(produce.status, {
              actualQuantity: produce.actualQuantity - order.quantity,
              floatingQuantity: produce.floatingQuantity,
            }),
          },
        });
        return confirmed;
      });
    } catch (error) {
      throw mapOrderRaceError(error);
    }
  }

  async prepare(user: User, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new ConflictException(
        `Only a accepted order can be prepared; this one is ${order.status}`,
      );
    }
    try {
      return await this.database.order.update({
        where: { id, status: OrderStatus.CONFIRMED },
        data: { status: OrderStatus.PREPARING, checklist: { create: {} } },
      });
    } catch (error) {
      throw mapOrderRaceError(error);
    }
  }

  async findChecklist(user: User, id: string) {
    const checklist = await this.database.orderChecklist.findFirst({
      where: { orderId: id, order: scopedTo(user) },
    });
    if (!checklist) {
      throw new NotFoundException(
        'Checklist not found; start preparing the order first',
      );
    }
    return checklist;
  }

  async updateChecklist(user: User, id: string, dto: UpdateOrderChecklistDto) {
    const order = await this.findOne(user, id);
    if (order.status !== OrderStatus.PREPARING) {
      throw new ConflictException(
        `The checklist can only change while preparing; this order is ${order.status}`,
      );
    }
    try {
      // Guarded on PREPARING so a tick can't land after the order moved on.
      return await this.database.orderChecklist.update({
        where: { orderId: id, order: { status: OrderStatus.PREPARING } },
        data: dto,
      });
    } catch (error) {
      throw mapOrderRaceError(error);
    }
  }

  // READY hands the order to an agent (HandoverService), whose handover ships
  // it. Fulfilment belongs to other roles and isn't handled here.
  async markReady(user: User, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== OrderStatus.PREPARING) {
      throw new ConflictException(
        `Only an order being prepared can be marked ready; this one is ${order.status}`,
      );
    }
    const checklist = await this.findChecklist(user, id);
    const unticked = CHECKLIST_ITEMS.filter((item) => !checklist[item]);
    if (unticked.length > 0) {
      throw new ConflictException(
        `Complete the preparation checklist first; unticked: ${unticked.join(', ')}`,
      );
    }
    // The agent whose cluster holds the farm takes the order from here. A farm
    // out of every cluster (mid re-verification) leaves it unassigned until
    // its next round is approved.
    const farm = await this.database.farm.findUniqueOrThrow({
      where: { id: order.farmId },
      select: { cluster: { select: { agentId: true } } },
    });
    try {
      return await this.database.order.update({
        where: {
          id,
          status: OrderStatus.PREPARING,
          checklist: { is: CHECKLIST_COMPLETE },
        },
        data: {
          status: OrderStatus.READY,
          handover: { create: { agentId: farm.cluster?.agentId ?? null } },
        },
      });
    } catch (error) {
      throw mapOrderRaceError(error);
    }
  }

  async cancel(user: User, id: string, dto: CancelOrderDto) {
    const order = await this.findOne(user, id);
    // Farmers may withdraw an order until it's ready; buyers only one not yet
    // accepted.
    const cancellable = isSeller(user)
      ? SELLER_CANCELLABLE
      : [OrderStatus.PENDING];
    if (!cancellable.includes(order.status)) {
      throw new ConflictException(
        `This order is ${order.status} and can no longer be cancelled`,
      );
    }
    try {
      return await this.database.$transaction(async (tx) => {
        const cancelled = await tx.order.update({
          where: { id, status: order.status },
          data: {
            status: OrderStatus.CANCELLED,
            cancellationReason: dto.reason,
          },
        });
        await releaseStock(tx, order);
        return cancelled;
      });
    } catch (error) {
      throw mapOrderRaceError(error);
    }
  }

  async remove(user: User, id: string) {
    const order = await this.findOne(user, id);
    // Once a farmer has acted on an order it is history; cancel it instead.
    if (order.buyerId !== user.id || order.status !== OrderStatus.PENDING) {
      throw new ConflictException('Only a pending order can be deleted');
    }
    try {
      return await this.database.$transaction(async (tx) => {
        const deleted = await tx.order.delete({
          where: { id, status: OrderStatus.PENDING },
        });
        await releaseStock(tx, order);
        return deleted;
      });
    } catch (error) {
      throw mapOrderRaceError(error);
    }
  }
}

/** Gives back the stock `order` took in the status it was in when read. */
async function releaseStock(tx: Prisma.TransactionClient, order: Order) {
  const produce = await tx.produce.findUniqueOrThrow({
    where: { id: order.produceId },
  });
  const floatingQuantity = produce.floatingQuantity + order.quantity;
  // Only a CONFIRMED (or later) order had committed actual stock.
  const actualQuantity =
    order.status === OrderStatus.PENDING
      ? produce.actualQuantity
      : produce.actualQuantity + order.quantity;
  return tx.produce.update({
    where: { id: produce.id },
    data: {
      floatingQuantity,
      actualQuantity,
      status: deriveProduceStatus(produce.status, {
        actualQuantity,
        floatingQuantity,
      }),
    },
  });
}

// Runs after a failed reservation to say why it failed.
function isSeller(user: User) {
  return user.role === Role.FARMER || user.role === Role.ADMIN;
}

function scopedTo(user: User): Prisma.OrderWhereInput {
  if (user.role === Role.ADMIN) {
    return {};
  }
  if (user.role === Role.FARMER) {
    return { farm: farmOwnedBy(user) };
  }
  return { buyerId: user.id };
}

function filtered(user: User, filter: OrderFilterDto): Prisma.OrderWhereInput {
  return {
    ...scopedTo(user),
    produceId: filter.produceId,
    status: filter.status,
    type: filter.type,
  };
}

// The row existed a moment ago, so no match means its status moved on.
function mapOrderRaceError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new ConflictException('Order was changed by someone else; retry');
  }
  return error;
}
