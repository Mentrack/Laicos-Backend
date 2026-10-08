import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, type User } from '../../generated/client';
import {
  orderLine,
  tryReserveProduce,
  type OrderLine,
} from '../order/utils/reservation';
import { isTransactionTimeout } from '../common/prisma-errors';
import { CheckoutConfig } from '../payment/checkout-config';
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

// Up to 50 items at ~3 statements each, plus time queued on the cart lock or
// on other buyers' produce row locks, can outrun Prisma's 5s default and
// surface as a bare 500.
const CHECKOUT_TRANSACTION = { timeout: 15_000, maxWait: 5_000 };

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
    try {
      return await this.placeOrders(user, idempotencyKey, dto);
    } catch (error) {
      // Rolled back, so a retry with the same key is safe. A 409 rather than
      // a 503: HttpExceptionFilter hides every 5xx behind a generic message,
      // and the client needs this code to know it can retry.
      if (isTransactionTimeout(error)) {
        throw new ConflictException({
          message: 'Checkout is busy; please try again',
          code: 'CHECKOUT_BUSY',
        });
      }
      throw error;
    }
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
      throw new NotFoundException({
        message: 'Checkout not found',
        code: 'CHECKOUT_NOT_FOUND',
      });
    }
    return formatCheckout(checkout);
  }
}

function needsAttention(problems: string[]) {
  return new ConflictException({
    message: problems,
    code: 'CART_NEEDS_ATTENTION',
  });
}
