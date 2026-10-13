import { NotFoundException } from '@nestjs/common';

export function checkoutNotFound() {
  return new NotFoundException({
    message: 'Checkout not found',
    code: 'CHECKOUT_NOT_FOUND',
  });
}

export function paymentNotFound() {
  return new NotFoundException({
    message: 'Payment not found',
    code: 'PAYMENT_NOT_FOUND',
  });
}
