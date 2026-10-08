import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { IdempotencyKey, idempotencyKeyPipe } from '../common/idempotency-key';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import {
  AddCartItemDto,
  CartDto,
  CartItemDto,
  CheckoutDto,
  CreateCheckoutDto,
  UpdateCartItemDto,
} from './dto';

@Controller('cart')
@ApiTags('Cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly checkouts: CheckoutService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get my cart',
    description:
      'Not paginated: capped at 50 items and checked out whole. Lines use current prices; items that can no longer be ordered stay, flagged by `issue`.',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(CartDto)
  async find(@CurrentUser() user: User) {
    const data = await this.cart.find(user);
    return { data, message: 'Cart retrieved' };
  }

  @Post('items')
  @ApiOperation({
    summary: 'Add to my cart',
    description:
      'Adds to the quantity if the produce is already in the cart. Reserves nothing; checkout does.',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(CartItemDto, { status: HttpStatus.CREATED })
  async addItem(@CurrentUser() user: User, @Body() dto: AddCartItemDto) {
    const data = await this.cart.addItem(user, dto);
    return { data, message: 'Added to cart' };
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Change a cart item’s quantity' })
  @Auth(Role.BUYER)
  @ApiEnvelope(CartItemDto)
  async updateItem(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const data = await this.cart.updateItem(user, id, dto);
    return { data, message: 'Cart updated' };
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove a cart item' })
  @Auth(Role.BUYER)
  @ApiEnvelope(CartItemDto)
  async removeItem(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.cart.removeItem(user, id);
    return { data, message: 'Removed from cart' };
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Check out my cart',
    description:
      'All or nothing: reserves stock for every item, places the orders AWAITING_PAYMENT under one checkout and empties the cart. Pay with POST /checkouts/{id}/payments before expiresAt or the stock is released. 409 CART_NEEDS_ATTENTION lists every item that cannot be ordered (in error.details); 409 CART_PRICE_CHANGED when items plus delivery no longer total expectedTotal. 404 ADDRESS_NOT_FOUND, 400 INVALID_DELIVERY_DATE. Retrying with the same Idempotency-Key returns the original checkout.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A UUID the client generates once per checkout attempt',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(CheckoutDto, { status: HttpStatus.CREATED })
  async checkout(
    @CurrentUser() user: User,
    @IdempotencyKey(idempotencyKeyPipe()) idempotencyKey: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    const data = await this.checkouts.checkout(user, idempotencyKey, dto);
    return { data, message: 'Order placed' };
  }
}
