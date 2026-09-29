import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentRequest } from '../agent-request';

/**
 * Loads the caller's Agent into `req.agent`, refusing agents an admin hasn't
 * verified yet. Needs `req.user`, so it must run after the `@Auth` chain.
 */
@Injectable()
export class VerifiedAgentGuard implements CanActivate {
  constructor(private readonly database: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentRequest>();
    const agent = await this.database.agent.findUnique({
      where: { userId: request.user.id },
    });
    if (!agent?.isVerified) {
      throw new ForbiddenException('Agent is not verified');
    }
    request.agent = agent;
    return true;
  }
}
