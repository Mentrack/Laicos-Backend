import { NotFoundException } from '@nestjs/common';

export function addressNotFound() {
  return new NotFoundException({
    message: 'Address not found',
    code: 'ADDRESS_NOT_FOUND',
  });
}
