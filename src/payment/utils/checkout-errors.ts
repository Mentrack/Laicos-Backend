import { NotFoundException } from '@nestjs/common';

export function checkoutNotFound() {
  return new NotFoundException({
    message: 'Checkout not found',
    code: 'CHECKOUT_NOT_FOUND',
  });
}
