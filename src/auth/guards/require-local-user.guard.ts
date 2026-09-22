import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../authenticated-request';

/** Loads the local user for `req.firebaseUser` into `req.user`. */
@Injectable()
export class RequireLocalUserGuard implements CanActivate {
  constructor(private readonly database: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.database.user.findUnique({
      where: { firebaseUid: request.firebaseUser.uid },
    });
    if (!user) {
      throw new ForbiddenException('Complete registration first');
    }
    request.user = user;
    return true;
  }
}
