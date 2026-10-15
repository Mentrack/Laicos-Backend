import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FarmerStatus, Role } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AllowSuspendedFarmer } from '../decorators/allow-suspended-farmer.decorator';

/**
 * Holds a suspended farmer off every route except those marked
 * `@AllowSuspendedFarmer()`. Needs `req.user`, so it runs after
 * `RequireLocalUserGuard`.
 */
@Injectable()
export class FarmerStandingGuard implements CanActivate {
  constructor(
    private readonly database: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user.role !== Role.FARMER) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride(AllowSuspendedFarmer, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }
    const farmer = await this.database.farmer.findUnique({
      where: { userId: user.id },
      select: { status: true },
    });
    if (farmer?.status === FarmerStatus.DISABLED) {
      throw new ForbiddenException({
        message: 'Your account is suspended',
        code: 'ACCOUNT_SUSPENDED',
      });
    }
    return true;
  }
}
