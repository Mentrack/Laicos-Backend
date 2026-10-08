import { Reflector } from '@nestjs/core';

/** Lets a user still on a temporary password reach this route. */
export const AllowPendingPasswordChange = Reflector.createDecorator<
  boolean | undefined
>({ transform: () => true });
