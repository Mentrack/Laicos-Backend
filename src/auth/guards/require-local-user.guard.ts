import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../authenticated-request';
import { requireLocalUser } from '../utils/session';

/** Loads the local user for `req.firebaseUser` into `req.user`. */
@Injectable()
export class RequireLocalUserGuard implements CanActivate {
  constructor(private readonly database: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await requireLocalUser(
      this.database,
      request.firebaseUser.uid,
    );
    return true;
  }
}
