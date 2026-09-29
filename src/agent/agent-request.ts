import type { Agent } from '../../generated/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

/** A request after `@VerifiedAgent()` has run. */
export interface AgentRequest extends AuthenticatedRequest {
  agent: Agent;
}
