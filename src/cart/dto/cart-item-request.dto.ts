import { PickType } from '@nestjs/swagger';
import { OrderLineDto } from '../../order/dto/order-line.dto';

// Same shape and rules as Buy Now: a published produce and a positive quantity.
export class AddCartItemDto extends PickType(OrderLineDto, [
  'produceId',
  'quantity',
] as const) {}

export class UpdateCartItemDto extends PickType(OrderLineDto, [
  'quantity',
] as const) {}
