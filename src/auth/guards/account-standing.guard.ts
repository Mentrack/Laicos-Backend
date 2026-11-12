import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../authenticated-request';
import { assertAccountInGoodStanding } from '../utils/session';
import { AllowSuspended } from '../decorators/allow-suspended.decorator';

/**
 * Holds a suspended farmer or extension agent off every route except those
 * marked `@AllowSuspended()`. Needs `req.user`, so it runs after
 * `RequireLocalUserGuard`.
 */
@Injectable()
export class AccountStandingGuard implements CanActivate {
  constructor(
    private readonly database: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user.role !== Role.FARMER && user.role !== Role.EXTENSION_AGENT) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride(AllowSuspended, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }
    await assertAccountInGoodStanding(this.database, user);
    return true;
  }
}
