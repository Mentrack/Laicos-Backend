import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User } from '../../generated/client';
import { isOrderable, orderRefusal } from '../order/utils/reservation';
import { CheckoutConfig } from '../payment/checkout-config';
import {
  CHECKOUT_TRANSACTION,
  busyAsConflict,
} from '../payment/utils/checkout-transaction';
import { PrismaService } from '../prisma/prisma.service';
import { requireBuyer } from '../buyer/utils/require-buyer';
import { visibleTo } from '../produce/utils/produce-visibility';
import {
  AddCartItemDto,
  CartLinesDto,
  CartMergeDto,
  CartQuoteDto,
  CartSkippedItemDto,
  UpdateCartItemDto,
} from './dto';
import {
  CART_ITEM_INCLUDE,
  CART_PRODUCE_INCLUDE,
  formatCart,
  formatCartItem,
  formatCartQuote,
  type CartItemRow,
  type CartLineRow,
} from './formatters/cart.formatter';
import { MAX_CART_ITEMS } from './utils/cart-limits';
import { lockCart } from './utils/cart-lock';

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
    const buyer = await requireBuyer(this.database, user);
    const items = await this.database.cartItem.findMany({
      where: { buyerId: buyer.id },
      include: CART_ITEM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return formatCart(items, this.config);
  }

  /** Prices a device (guest) cart; reads nobody's server cart. */
  async quote(dto: CartLinesDto): Promise<CartQuoteDto> {
    const found = await this.database.produce.findMany({
      where: {
        id: { in: dto.items.map((line) => line.produceId) },
        ...visibleTo(null),
      },
      include: CART_PRODUCE_INCLUDE,
    });
    const byId = new Map(found.map((produce) => [produce.id, produce]));
    const lines: CartLineRow[] = [];
    const unavailableProduceIds: string[] = [];
    for (const { produceId, quantity } of dto.items) {
      const produce = byId.get(produceId);
      if (produce) {
        lines.push({ quantity, produce });
      } else {
        unavailableProduceIds.push(produceId);
      }
    }
    return {
      ...formatCartQuote(lines, this.config),
      unavailableProduceIds,
    };
  }

  async addItem(user: User, dto: AddCartItemDto) {
    const buyer = await requireBuyer(this.database, user);
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, buyer.id);
      const result = await tryAddLine(tx, buyer.id, dto);
      if (result instanceof HttpException) {
        throw result;
      }
      return formatCartItem(result);
    });
  }

  /**
   * Merges a device (guest) cart after sign-in. Adds like addItem, but skips
   * and reports what it can't add, so one sold-out item doesn't lose the rest.
   * Adding isn't idempotent, so a repeated key replays instead of re-adding.
   */
  async mergeItems(
    user: User,
    idempotencyKey: string,
    dto: CartLinesDto,
  ): Promise<CartMergeDto> {
    const buyer = await requireBuyer(this.database, user);
    return busyAsConflict(
      () =>
        this.database.$transaction(async (tx) => {
          await lockCart(tx, buyer.id);
          const replay = await tx.cartMerge.findUnique({
            where: {
              buyerId_idempotencyKey: { buyerId: buyer.id, idempotencyKey },
            },
          });
          const skipped = replay
            ? storedSkipped(replay.skipped)
            : await addLines(tx, buyer.id, dto);
          if (!replay) {
            await tx.cartMerge.create({
              data: {
                buyerId: buyer.id,
                idempotencyKey,
                skipped: skipped.map(({ produceId, code, message }) => ({
                  produceId,
                  code,
                  message,
                })),
              },
            });
          }
          const items = await tx.cartItem.findMany({
            where: { buyerId: buyer.id },
            include: CART_ITEM_INCLUDE,
            orderBy: { createdAt: 'desc' },
          });
          return { ...formatCart(items, this.config), skipped };
        }, CHECKOUT_TRANSACTION),
      { message: 'Your cart is busy; please try again', code: 'CART_BUSY' },
    );
  }

  async updateItem(user: User, id: string, dto: UpdateCartItemDto) {
    const buyer = await requireBuyer(this.database, user);
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, buyer.id);
      const item = await findOwnItem(tx, buyer.id, id);
      await assertOrderable(tx, item.produceId, dto.quantity);
      const updated = await tx.cartItem.update({
        where: { id },
        data: { quantity: dto.quantity },
        include: CART_ITEM_INCLUDE,
      });
      return formatCartItem(updated);
    });
  }

  async removeItem(user: User, id: string) {
    const buyer = await requireBuyer(this.database, user);
    return this.database.$transaction(async (tx) => {
      await lockCart(tx, buyer.id);
      await findOwnItem(tx, buyer.id, id);
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
  buyerId: string,
  id: string,
) {
  const item = await tx.cartItem.findFirst({
    where: { id, buyerId },
  });
  if (!item) {
    throw new NotFoundException({
      message: 'Cart item not found',
      code: 'CART_ITEM_NOT_FOUND',
    });
  }
  return item;
}

async function addLines(
  tx: Prisma.TransactionClient,
  buyerId: string,
  dto: CartLinesDto,
): Promise<CartSkippedItemDto[]> {
  const skipped: CartSkippedItemDto[] = [];
  for (const line of dto.items) {
    const result = await tryAddLine(tx, buyerId, line);
    if (result instanceof HttpException) {
      skipped.push(skippedLine(line.produceId, result));
    }
  }
  return skipped;
}

/**
 * Adds `line` to the buyer's cart, or returns why it can't. The caller must
 * hold the cart lock.
 */
async function tryAddLine(
  tx: Prisma.TransactionClient,
  buyerId: string,
  line: AddCartItemDto,
): Promise<CartItemRow | HttpException> {
  const key = { buyerId, produceId: line.produceId };
  const existing = await tx.cartItem.findUnique({
    where: { buyerId_produceId: key },
  });
  if (
    !existing &&
    (await tx.cartItem.count({ where: { buyerId } })) >= MAX_CART_ITEMS
  ) {
    return new ConflictException({
      message: `Your cart can hold at most ${MAX_CART_ITEMS} items`,
      code: 'CART_FULL',
    });
  }
  const quantity = (existing?.quantity ?? 0) + line.quantity;
  const refusal = await orderableRefusal(tx, line.produceId, quantity);
  if (refusal) {
    return refusal;
  }
  return tx.cartItem.upsert({
    where: { buyerId_produceId: key },
    create: { ...key, quantity },
    update: { quantity },
    include: CART_ITEM_INCLUDE,
  });
}

async function assertOrderable(
  tx: Prisma.TransactionClient,
  produceId: string,
  quantity: number,
) {
  const refusal = await orderableRefusal(tx, produceId, quantity);
  if (refusal) {
    throw refusal;
  }
}

async function orderableRefusal(
  tx: Prisma.TransactionClient,
  produceId: string,
  quantity: number,
): Promise<HttpException | null> {
  const produce = await tx.produce.findUnique({
    where: { id: produceId },
    include: { farm: { select: { verificationStatus: true } } },
  });
  return isOrderable(produce, quantity) ? null : orderRefusal(produce);
}

function skippedLine(
  produceId: string,
  refusal: HttpException,
): CartSkippedItemDto {
  const body = refusal.getResponse();
  const code =
    typeof body === 'object' && 'code' in body && typeof body.code === 'string'
      ? body.code
      : 'UNAVAILABLE';
  return { produceId, code, message: refusal.message };
}

// Written by mergeItems as CartSkippedItemDto[]; narrowed back field by field
// because Prisma types the column as untyped JSON.
function storedSkipped(value: Prisma.JsonValue): CartSkippedItemDto[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) =>
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof entry.produceId === 'string' &&
    typeof entry.code === 'string' &&
    typeof entry.message === 'string'
      ? [
          {
            produceId: entry.produceId,
            code: entry.code,
            message: entry.message,
          },
        ]
      : [],
  );
}
