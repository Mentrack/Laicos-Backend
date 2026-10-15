import { Reflector } from '@nestjs/core';

/** Lets a suspended farmer reach this route, so the client can read who they are. */
export const AllowSuspendedFarmer = Reflector.createDecorator<
  boolean | undefined
>({ transform: () => true });
