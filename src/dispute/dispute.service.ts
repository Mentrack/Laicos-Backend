import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  DisputeStatus,
  NotificationType,
  OrderStatus,
  PaymentStatus,
  PayoutItemKind,
  Prisma,
  Role,
  type Refund,
  type User,
} from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { advisoryLock } from '../common/advisory-lock';
import { farmOwnedBy } from '../common/ownership';
import { paginationMeta, resolvePagination } from '../common/pagination';
import { isRecordNotFound, isUniqueViolation } from '../common/prisma-errors';
import {
  IMAGE_SIGNATURES,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { NotificationService } from '../notifications/notification.service';
import { RefundService } from '../payment/refund.service';
import { PayoutConfig } from '../payout/payout.config';
import { disputeWindowOpen } from '../payout/utils/dispute-window';
import { LIVE_PAYOUT_STATUSES } from '../payout/utils/eligibility';
import {
  PAYEE_SELECT,
  lockPayees,
  payeeUserId,
} from '../payout/utils/payee-locks';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  DisputeDto,
  DisputeQueryDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
} from './dto';
import {
  DISPUTE_INCLUDE,
  formatDispute,
  type DisputeRow,
} from './formatters/dispute.formatter';

export const MAX_DISPUTE_PHOTOS = 5;

const ORDER_SELECT = {
  ...PAYEE_SELECT,
  id: true,
  orderNumber: true,
  quantity: true,
  status: true,
  fulfilledAt: true,
  farmId: true,
  checkoutId: true,
  totalPrice: true,
  agentCommission: true,
  buyer: { select: { userId: true } },
  dispute: { select: { id: true } },
  payoutItems: {
    where: { status: { in: LIVE_PAYOUT_STATUSES } },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.OrderSelect;

type DisputeOrder = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

function disputeNotFound() {
  return new NotFoundException({
    message: 'Dispute not found',
    code: 'DISPUTE_NOT_FOUND',
  });
}

function disputeExists() {
  return new ConflictException({
    message: 'This order already has a dispute',
    code: 'DISPUTE_EXISTS',
  });
}

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notification: NotificationService,
    private readonly refunds: RefundService,
    private readonly payoutConfig: PayoutConfig,
  ) {}

  async raise(
    user: User,
    orderId: string,
    dto: RaiseDisputeDto,
    photos: StorageUploadFile[],
  ): Promise<DisputeDto> {
    const order = await this.database.order.findFirst({
      where: { id: orderId, buyer: { userId: user.id } },
      select: ORDER_SELECT,
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      });
    }
    if (dto.quantityAffected > order.quantity) {
      throw new BadRequestException({
        message: `quantityAffected must be between 1 and ${order.quantity}`,
        code: 'INVALID_QUANTITY',
      });
    }
    // Checked before uploading so a doomed request stores nothing; checked
    // again under the locks, where it counts.
    this.assertDisputable(order);
    const keys = await this.uploadPhotos(orderId, photos);
    let deliveryIds: string[] = [];
    let dispute: DisputeRow;
    try {
      dispute = await this.database.$transaction(async (tx) => {
        // The payout run takes these before creating items, so either it
        // sees this dispute or this sees its item: never both paid and open.
        await lockPayees(tx, { id: orderId });
        const current = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: ORDER_SELECT,
        });
        this.assertDisputable(current);
        const created = await tx.dispute.create({
          data: {
            orderId,
            raisedById: user.id,
            reason: dto.reason,
            quantityAffected: dto.quantityAffected,
            photos: { create: keys.map((key) => ({ key })) },
          },
          include: DISPUTE_INCLUDE,
        });
        await this.audit.record(tx, {
          actorType: AuditActorType.BUYER,
          farmerId: null,
          agentId: null,
          farmId: current.farmId,
          category: AuditCategory.DISPUTE,
          title: 'Dispute raised',
          summary: `${current.orderNumber}: ${dto.quantityAffected} of ${current.quantity} affected`,
          actionLabel: 'View dispute',
          resource: AuditResource.DISPUTE,
          resourceId: created.id,
        });
        const admins = await tx.user.findMany({
          where: { role: Role.ADMIN },
          select: { id: true },
        });
        deliveryIds = await this.notification.notify(
          {
            userIds: unique([
              ...admins.map((admin) => admin.id),
              ...payees(current),
            ]),
            type: NotificationType.DISPUTE_RAISED,
            params: {
              disputeId: created.id,
              orderId,
              orderNumber: current.orderNumber,
              reason: dto.reason,
            },
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      await this.storage.deletePrivate(keys);
      // A concurrent raise on the same order won the unique orderId.
      if (isUniqueViolation(error)) {
        throw disputeExists();
      }
      throw error;
    }
    void this.notification.dispatch(deliveryIds);
    return formatDispute(this.storage, dispute);
  }

  async findForOrder(user: User, orderId: string): Promise<DisputeDto> {
    const dispute = await this.database.dispute.findFirst({
      where: { orderId, order: orderVisibleTo(user) },
      include: DISPUTE_INCLUDE,
    });
    if (!dispute) {
      throw disputeNotFound();
    }
    return formatDispute(this.storage, dispute);
  }

  async findAll(query: DisputeQueryDto) {
    const { page, perPage, skip, take } = resolvePagination(query);
    const where: Prisma.DisputeWhereInput = { status: query.status };
    const [rows, total] = await this.database.$transaction([
      this.database.dispute.findMany({
        where,
        include: DISPUTE_INCLUDE,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      this.database.dispute.count({ where }),
    ]);
    return {
      data: await Promise.all(
        rows.map((row) => formatDispute(this.storage, row)),
      ),
      metaData: paginationMeta(page, perPage, total),
    };
  }

  async findOne(id: string): Promise<DisputeDto> {
    const dispute = await this.database.dispute.findUnique({
      where: { id },
      include: DISPUTE_INCLUDE,
    });
    if (!dispute) {
      throw disputeNotFound();
    }
    return formatDispute(this.storage, dispute);
  }

  async resolve(
    admin: User,
    id: string,
    dto: ResolveDisputeDto,
  ): Promise<DisputeDto> {
    const found = await this.database.dispute.findUnique({
      where: { id },
      include: DISPUTE_INCLUDE,
    });
    if (!found) {
      throw disputeNotFound();
    }
    const refundPercent = new Prisma.Decimal(dto.refundPercent);
    const { checkoutId } = found.order;
    const payment = checkoutId
      ? await this.database.payment.findFirst({
          where: { checkoutId, status: PaymentStatus.SUCCEEDED },
          select: { id: true, reference: true },
        })
      : null;
    if (refundPercent.gt(0) && !payment) {
      throw new ConflictException({
        message: 'This order has no successful payment to refund',
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
    }
    const now = new Date();
    let deliveryIds: string[] = [];
    const refund = await this.database.$transaction(async (tx) => {
      // The same lock refund() takes, so the balance can't move under us.
      // Payee locks are not taken: the payout run skips OPEN disputes.
      if (payment) {
        await advisoryLock(tx, `payment:${payment.id}`);
      }
      const dispute = await this.resolveOpen(tx, id, {
        status: DisputeStatus.RESOLVED,
        refundPercent,
        resolutionNote: dto.note,
        resolvedById: admin.id,
        resolvedAt: now,
      });
      const order = await tx.order.findUniqueOrThrow({
        where: { id: dispute.orderId },
        select: ORDER_SELECT,
      });
      // The admin's decision ends an order the buyer never confirmed.
      await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.SHIPPED },
        data: { status: OrderStatus.FULFILLED, fulfilledAt: now },
      });
      let created: Refund | null = null;
      if (payment && refundPercent.gt(0)) {
        const locked = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: { checkout: true, refunds: true },
        });
        created = await this.refunds.createForDispute(
          tx,
          locked,
          order,
          dispute,
          admin,
        );
      }
      await this.audit.record(tx, {
        actorType: AuditActorType.ADMIN,
        farmerId: null,
        agentId: null,
        farmId: order.farmId,
        category: AuditCategory.DISPUTE,
        title: 'Dispute resolved',
        summary: `${order.orderNumber}: ${refundPercent.toFixed(2)}% refunded`,
        actionLabel: 'View dispute',
        resource: AuditResource.DISPUTE,
        resourceId: dispute.id,
      });
      deliveryIds = await this.notification.notify(
        {
          userIds: unique([order.buyer.userId, ...payees(order)]),
          type: NotificationType.DISPUTE_RESOLVED,
          params: {
            disputeId: dispute.id,
            orderId: order.id,
            orderNumber: order.orderNumber,
            refundPercent: refundPercent.toFixed(2),
          },
        },
        tx,
      );
      return created;
    });
    if (refund && payment) {
      // Logged before Paystack is called: a crash now leaves this to find
      // the PENDING refund without a providerRefundId.
      this.logger.warn(
        `Submitting dispute refund ${refund.id} on ${payment.reference}`,
      );
      await this.refunds.submit(refund, payment.reference);
    }
    void this.notification.dispatch(deliveryIds);
    return this.findOne(id);
  }

  /** The OPEN check and the write are one statement. */
  private async resolveOpen(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.DisputeUncheckedUpdateInput,
  ) {
    try {
      return await tx.dispute.update({
        where: { id, status: DisputeStatus.OPEN },
        data,
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new ConflictException({
          message: 'This dispute has already been resolved',
          code: 'DISPUTE_RESOLVED',
        });
      }
      throw error;
    }
  }

  private assertDisputable(order: DisputeOrder): void {
    if (order.dispute) {
      throw disputeExists();
    }
    const inWindow =
      order.status === OrderStatus.SHIPPED ||
      (order.status === OrderStatus.FULFILLED &&
        order.fulfilledAt !== null &&
        disputeWindowOpen(
          order.fulfilledAt,
          this.payoutConfig.holdHours,
          new Date(),
        ));
    // A live payout item means the money is already on its way.
    if (!inWindow || order.payoutItems.length > 0) {
      throw new ConflictException({
        message: 'This order can no longer be disputed',
        code: 'DISPUTE_WINDOW_CLOSED',
      });
    }
  }

  /** Uploads every photo, or none: a failure removes the ones stored. */
  private async uploadPhotos(
    orderId: string,
    photos: StorageUploadFile[],
  ): Promise<string[]> {
    const keys: string[] = [];
    try {
      for (const photo of photos) {
        keys.push(
          await this.storage.uploadPrivateFile(
            `disputes/${orderId}`,
            photo,
            IMAGE_SIGNATURES,
          ),
        );
      }
    } catch (error) {
      await this.storage.deletePrivate(keys);
      throw error;
    }
    return keys;
  }
}

function payees(order: DisputeOrder): string[] {
  return Object.values(PayoutItemKind).flatMap(
    (kind) => payeeUserId(order, kind) ?? [],
  );
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** The buyer, the farm owner and the handover agent see an order's dispute. */
function orderVisibleTo(user: User): Prisma.OrderWhereInput {
  if (user.role === Role.ADMIN) {
    return {};
  }
  return {
    OR: [
      { buyer: { userId: user.id } },
      { farm: farmOwnedBy(user) },
      { handover: { agent: { userId: user.id } } },
    ],
  };
}
