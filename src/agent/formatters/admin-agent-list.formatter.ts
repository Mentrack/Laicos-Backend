import type { Prisma } from '../../../generated/client';
import type { LgaDto, StateDto } from '../../location/dto';
import { OPEN_SOURCING_REQUEST } from '../../sourcing-request/utils/sourcing-rules';
import { isCurrentlySuspended } from '../utils/agent-suspension';
import { AgentVerificationStatus, type AdminAgentListItemDto } from '../dto';

export const AGENT_LOCATION_SELECT = {
  state: { select: { id: true, name: true } },
  lga: { select: { id: true, stateId: true, name: true } },
} satisfies Prisma.AgentSelect;

export const AGENT_LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  avatarUrl: true,
  createdAt: true,
  agent: {
    select: {
      id: true,
      agentId: true,
      isVerified: true,
      rejectedAt: true,
      suspendedAt: true,
      suspendedUntil: true,
      ...AGENT_LOCATION_SELECT,
      cluster: { select: { _count: { select: { farms: true } } } },
      _count: {
        select: { assignedSourcingRequests: { where: OPEN_SOURCING_REQUEST } },
      },
    },
  },
  application: { select: { stateId: true, lgaId: true } },
} satisfies Prisma.UserSelect;

export type AgentListRow = Prisma.UserGetPayload<{
  select: typeof AGENT_LIST_SELECT;
}>;

export function verificationStatus(
  agent: {
    isVerified: boolean;
    rejectedAt: Date | null;
    suspendedAt: Date | null;
    suspendedUntil: Date | null;
  } | null,
  now: Date = new Date(),
): AgentVerificationStatus {
  if (!agent) {
    return AgentVerificationStatus.ONBOARDING;
  }
  if (agent.rejectedAt) {
    return AgentVerificationStatus.REJECTED;
  }
  if (!agent.isVerified) {
    return AgentVerificationStatus.PENDING;
  }
  return isCurrentlySuspended(agent, now)
    ? AgentVerificationStatus.SUSPENDED
    : AgentVerificationStatus.VERIFIED;
}

export function toAdminAgentListItem(
  { id: userId, agent, application, ...user }: AgentListRow,
  states: Map<string, StateDto>,
  lgas: Map<string, LgaDto>,
): AdminAgentListItemDto {
  const lookup = <T>(names: Map<string, T>, id: string | null | undefined) =>
    (id ? names.get(id) : undefined) ?? null;
  return {
    userId,
    id: agent?.id ?? null,
    agentId: agent?.agentId ?? null,
    ...user,
    state: agent ? agent.state : lookup(states, application?.stateId),
    lga: agent ? agent.lga : lookup(lgas, application?.lgaId),
    status: verificationStatus(agent),
    assignedFarms: agent?.cluster?._count.farms ?? 0,
    // One cluster per agent today; agents will get several.
    activeClusters: agent?.cluster ? 1 : 0,
    pendingRequests: agent?._count.assignedSourcingRequests ?? 0,
  };
}
