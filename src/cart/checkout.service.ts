import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  CheckoutStatus,
  Role,
  type User,
} from '../../generated/client';
import { requireBuyer } from '../buyer/utils/require-buyer';
import {
  orderLine,
  tryReserveProduce,
  type OrderLine,
} from '../order/utils/reservation';
import { CheckoutConfig } from '../payment/checkout-config';
import { checkoutNotFound } from '../payment/utils/checkout-errors';
import { lockCheckout } from '../payment/utils/checkout-lock';
import {
  CHECKOUT_TRANSACTION,
  busyAsConflict,
} from '../payment/utils/checkout-transaction';
import { releaseCheckout } from '../payment/utils/release-checkout';
import { PrismaService } from '../prisma/prisma.service';
import {
  recordLinkedAudit,
  syncSourcingRequest,
} from '../sourcing-request/utils/sync-sourcing-request';
import { CreateCheckoutDto } from './dto';
import { CART_ITEM_INCLUDE } from './formatters/cart.formatter';
import {
  CHECKOUT_INCLUDE,
  formatCheckout,
} from './formatters/checkout.formatter';
import {
  cartItemIssue,
  describeIssue,
  describeLostReservation,
} from './utils/cart-issue';
import { lockCart } from './utils/cart-lock';
import {
  createCheckout,
  findReplay,
  resolveDelivery,
} from './utils/place-checkout';

/**
 * Turns a buyer's cart into orders awaiting payment, all or nothing.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: CheckoutConfig,
  ) {}

  async checkout(user: User, idempotencyKey: string, dto: CreateCheckoutDto) {
    const buyer = await requireBuyer(this.database, user);
    return busyAsConflict(() =>
      this.placeOrders(buyer.id, idempotencyKey, dto),
    );
  }

  private placeOrders(
    buyerId: string,
    idempotencyKey: string,
    dto: CreateCheckoutDto,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, buyerId);
      const replay = await findReplay(tx, buyerId, idempotencyKey);
      if (replay) {
        return formatCheckout(replay);
      }

      // produceId order makes overlapping checkouts lock produce rows in the
      // same sequence, so they queue instead of deadlocking.
      const items = await tx.cartItem.findMany({
        where: { buyerId },
        include: CART_ITEM_INCLUDE,
        orderBy: { produceId: 'asc' },
      });
      if (items.length === 0) {
        throw new BadRequestException({
          message: 'Your cart is empty',
          code: 'CART_EMPTY',
        });
      }
      const problems = items.flatMap((item) => {
        const issue = cartItemIssue(item);
        return issue ? [describeIssue(item, issue)] : [];
      });
      if (problems.length > 0) {
        throw needsAttention(problems);
      }
      const delivery = await resolveDelivery(
        tx,
        buyerId,
        dto.addressId,
        dto.deliveryDate,
        this.config,
      );

      const lines: OrderLine[] = [];
      for (const item of items) {
        // Stock can still go between the check above and here: another buyer
        // may hold the row lock and commit first.
        const { produce, reserved } = await tryReserveProduce(
          tx,
          item.produceId,
          item.quantity,
        );
        if (!reserved || !produce) {
          throw needsAttention([
            describeLostReservation(item.produce.name, produce),
          ]);
        }
        lines.push(orderLine(produce, item.quantity));
      }
      const checkout = await createCheckout(
        tx,
        {
          buyerId,
          idempotencyKey,
          lines,
          delivery,
          expectedTotal: dto.expectedTotal,
        },
        this.config,
      );
      await tx.cartItem.deleteMany({ where: { buyerId } });
      return formatCheckout(checkout);
    }, CHECKOUT_TRANSACTION);
  }

  async findOne(user: User, id: string) {
    const buyerId =
      user.role === Role.ADMIN
        ? undefined
        : (await requireBuyer(this.database, user)).id;
    const checkout = await this.database.checkout.findFirst({
      where: { id, ...(buyerId ? { buyerId } : {}) },
      include: CHECKOUT_INCLUDE,
    });
    if (!checkout) {
      throw checkoutNotFound();
    }
    return formatCheckout(checkout);
  }

  async cancel(user: User, id: string) {
    const buyer = await requireBuyer(this.database, user);
    return busyAsConflict(() => this.release(buyer.id, id));
  }

  private release(buyerId: string, id: string) {
    return this.database.$transaction(async (tx) => {
      await lockCheckout(tx, id);
      const checkout = await tx.checkout.findFirst({
        where: { id, buyerId },
      });
      if (!checkout) {
        throw checkoutNotFound();
      }
      if (checkout.status !== CheckoutStatus.AWAITING_PAYMENT) {
        throw new ConflictException({
          message: 'Only an unpaid checkout can be cancelled',
          code: 'CHECKOUT_NOT_CANCELLABLE',
        });
      }
      const released = await releaseCheckout(
        tx,
        id,
        CheckoutStatus.CANCELLED,
        'Cancelled by buyer',
      );
      if (checkout.sourcingRequestId) {
        await syncSourcingRequest(tx, checkout.sourcingRequestId);
        await recordLinkedAudit(tx, {
          actorType: AuditActorType.BUYER,
          farmerId: null,
          agentId: null,
          farmId: null,
          category: AuditCategory.ORDER,
          title: 'Checkout cancelled',
          summary: 'Cancelled by buyer',
          actionLabel: 'View request',
          resource: AuditResource.SOURCING_REQUEST,
          resourceId: checkout.sourcingRequestId,
          sourcingRequestId: checkout.sourcingRequestId,
        });
      }
      return formatCheckout(released);
    }, CHECKOUT_TRANSACTION);
  }
}

function needsAttention(problems: string[]) {
  return new ConflictException({
    message: problems,
    code: 'CART_NEEDS_ATTENTION',
  });
}
