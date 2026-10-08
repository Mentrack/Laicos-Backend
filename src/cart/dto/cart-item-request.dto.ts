import { PickType } from '@nestjs/swagger';
import { CreateOrderDto } from '../../order/dto';

// Same shape and rules as Buy Now: a published produce and a positive quantity.
export class AddCartItemDto extends PickType(CreateOrderDto, [
  'produceId',
  'quantity',
] as const) {}

export class UpdateCartItemDto extends PickType(CreateOrderDto, [
  'quantity',
] as const) {}
