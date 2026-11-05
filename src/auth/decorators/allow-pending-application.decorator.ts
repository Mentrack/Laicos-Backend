import { Reflector } from '@nestjs/core';

/** Lets a self-signup farmer or agent reach this route before they are verified. */
export const AllowPendingApplication = Reflector.createDecorator<
  boolean | undefined
>({ transform: () => true });
