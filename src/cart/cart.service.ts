import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User } from '../../generated/client';
import { isOrderable, orderRefusal } from '../order/utils/reservation';
import { CheckoutConfig } from '../payment/checkout-config';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto';
import {
  CART_ITEM_INCLUDE,
  formatCart,
  formatCartItem,
} from './formatters/cart.formatter';
import { lockCart } from './utils/cart-lock';

// Bounds GET /cart, which is unpaginated because checkout takes it whole.
const MAX_CART_ITEMS = 50;

/**
 * A buyer's cart. Nothing here reserves stock; the checks only give early
 * feedback, and checkout re-checks under the row locks.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: CheckoutConfig,
  ) {}

  async find(user: User) {
    const items = await this.database.cartItem.findMany({
      where: { buyerId: user.id },
      include: CART_ITEM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return formatCart(items, this.config.deliveryFee);
  }

  addItem(user: User, dto: AddCartItemDto) {
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, user.id);
      const key = { buyerId: user.id, produceId: dto.produceId };
      const existing = await tx.cartItem.findUnique({
        where: { buyerId_produceId: key },
      });
      if (
        !existing &&
        (await tx.cartItem.count({ where: { buyerId: user.id } })) >=
          MAX_CART_ITEMS
      ) {
        throw new ConflictException({
          message: `Your cart can hold at most ${MAX_CART_ITEMS} items`,
          code: 'CART_FULL',
        });
      }
      const quantity = (existing?.quantity ?? 0) + dto.quantity;
      await assertOrderable(tx, dto.produceId, quantity);
      const item = await tx.cartItem.upsert({
        where: { buyerId_produceId: key },
        create: { ...key, quantity },
        update: { quantity },
        include: CART_ITEM_INCLUDE,
      });
      return formatCartItem(item);
    });
  }

  updateItem(user: User, id: string, dto: UpdateCartItemDto) {
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, user.id);
      const item = await findOwnItem(tx, user, id);
      await assertOrderable(tx, item.produceId, dto.quantity);
      const updated = await tx.cartItem.update({
        where: { id },
        data: { quantity: dto.quantity },
        include: CART_ITEM_INCLUDE,
      });
      return formatCartItem(updated);
    });
  }

  removeItem(user: User, id: string) {
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, user.id);
      await findOwnItem(tx, user, id);
      const removed = await tx.cartItem.delete({
        where: { id },
        include: CART_ITEM_INCLUDE,
      });
      return formatCartItem(removed);
    });
  }
}

async function findOwnItem(
  tx: Prisma.TransactionClient,
  user: User,
  id: string,
) {
  const item = await tx.cartItem.findFirst({
    where: { id, buyerId: user.id },
  });
  if (!item) {
    throw new NotFoundException({
      message: 'Cart item not found',
      code: 'CART_ITEM_NOT_FOUND',
    });
  }
  return item;
}

async function assertOrderable(
  tx: Prisma.TransactionClient,
  produceId: string,
  quantity: number,
) {
  const produce = await tx.produce.findUnique({
    where: { id: produceId },
    include: { farm: { select: { verificationStatus: true } } },
  });
  if (!isOrderable(produce, quantity)) {
    throw orderRefusal(produce);
  }
}
