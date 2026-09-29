import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { Role, type Agent } from '../../../generated/client';
import { Auth } from '../../auth/decorators/auth.decorator';
import type { AgentRequest } from '../agent-request';
import { VerifiedAgentGuard } from '../guards/verified-agent.guard';

/**
 * `@Auth(EXTENSION_AGENT)` followed by `VerifiedAgentGuard`. Composed here
 * because guard order is decorator order: `@UseGuards` stacked under `@Auth`
 * on a method runs first, before `req.user` exists. `@Auth` itself stays
 * free of it, like `RequireVerifiedGuard`.
 */
export const VerifiedAgent = () =>
  applyDecorators(Auth(Role.EXTENSION_AGENT), UseGuards(VerifiedAgentGuard));

/** The verified agent loaded by `@VerifiedAgent()`. */
export const CurrentAgent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Agent =>
    context.switchToHttp().getRequest<AgentRequest>().agent,
);
