import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { OrderLineDto } from '../../order/dto/order-line.dto';
import { MAX_CART_ITEMS } from '../utils/cart-limits';

// Same shape and rules as Buy Now: a published produce and a positive quantity.
export class AddCartItemDto extends PickType(OrderLineDto, [
  'produceId',
  'quantity',
] as const) {}

export class UpdateCartItemDto extends PickType(OrderLineDto, [
  'quantity',
] as const) {}

export class CartLinesDto {
  @ApiProperty({
    type: [AddCartItemDto],
    description: `1 to ${MAX_CART_ITEMS} lines, each produceId once`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_ITEMS)
  @ArrayUnique((line: AddCartItemDto) => line.produceId, {
    message: 'Each produceId may appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => AddCartItemDto)
  items: AddCartItemDto[];
}
