import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { CheckoutStatus, Role, type User } from '../../generated/client';
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

  checkout(user: User, idempotencyKey: string, dto: CreateCheckoutDto) {
    return busyAsConflict(() => this.placeOrders(user, idempotencyKey, dto));
  }

  private placeOrders(
    user: User,
    idempotencyKey: string,
    dto: CreateCheckoutDto,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, user.id);
      const replay = await findReplay(tx, user.id, idempotencyKey);
      if (replay) {
        return formatCheckout(replay);
      }

      // produceId order makes overlapping checkouts lock produce rows in the
      // same sequence, so they queue instead of deadlocking.
      const items = await tx.cartItem.findMany({
        where: { buyerId: user.id },
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
        user.id,
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
          buyerId: user.id,
          idempotencyKey,
          lines,
          delivery,
          expectedTotal: dto.expectedTotal,
        },
        this.config,
      );
      await tx.cartItem.deleteMany({ where: { buyerId: user.id } });
      return formatCheckout(checkout);
    }, CHECKOUT_TRANSACTION);
  }

  async findOne(user: User, id: string) {
    const checkout = await this.database.checkout.findFirst({
      where: { id, ...(user.role === Role.ADMIN ? {} : { buyerId: user.id }) },
      include: CHECKOUT_INCLUDE,
    });
    if (!checkout) {
      throw checkoutNotFound();
    }
    return formatCheckout(checkout);
  }

  cancel(user: User, id: string) {
    return busyAsConflict(() => this.release(user, id));
  }

  private release(user: User, id: string) {
    return this.database.$transaction(async (tx) => {
      await lockCheckout(tx, id);
      const checkout = await tx.checkout.findFirst({
        where: { id, buyerId: user.id },
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
