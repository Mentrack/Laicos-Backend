import { Reflector } from '@nestjs/core';

/** Lets a suspended farmer or agent reach this route, so the client can read who they are and sign out. */
export const AllowSuspended = Reflector.createDecorator<boolean | undefined>({
  transform: () => true,
});
