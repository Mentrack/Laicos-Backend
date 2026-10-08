import { IntersectionType } from '@nestjs/swagger';
// Straight from the file, not the cart barrel: cart/dto/index loads
// checkout.dto, which loads order.dto, and a barrel import would cycle.
import { CreateCheckoutDto } from '../../cart/dto/create-checkout.dto';
import { OrderLineDto } from './order-line.dto';

/** Buy Now: one line plus everything a checkout needs. */
export class CreateOrderDto extends IntersectionType(
  OrderLineDto,
  CreateCheckoutDto,
) {}
