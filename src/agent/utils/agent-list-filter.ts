import { Prisma, Role } from '../../../generated/client';
import {
  currentlySuspendedWhere,
  notCurrentlySuspendedWhere,
} from './agent-suspension';
import { AgentVerificationStatus, type AdminAgentQueryDto } from '../dto';

// The Agent row is created when the application is completed, so every
// agent neither verified nor rejected is waiting on an admin.
export const PENDING_AGENT = {
  isVerified: false,
  rejectedAt: null,
} satisfies Prisma.AgentWhereInput;

function statusWhere(
  status: AgentVerificationStatus,
  now: Date,
): Prisma.UserWhereInput {
  switch (status) {
    case AgentVerificationStatus.ONBOARDING:
      return { agent: { is: null } };
    case AgentVerificationStatus.PENDING:
      return { agent: { is: PENDING_AGENT } };
    case AgentVerificationStatus.VERIFIED:
      return {
        agent: { is: { isVerified: true, ...notCurrentlySuspendedWhere(now) } },
      };
    case AgentVerificationStatus.SUSPENDED:
      return {
        agent: { is: { isVerified: true, ...currentlySuspendedWhere(now) } },
      };
    case AgentVerificationStatus.REJECTED:
      return { agent: { is: { rejectedAt: { not: null } } } };
  }
}

// Onboarding agents have a location only on their application.
function locationWhere(
  location: { stateId: string } | { lgaId: string },
): Prisma.UserWhereInput {
  return {
    OR: [
      { agent: { is: location } },
      { agent: { is: null }, application: { is: location } },
    ],
  };
}

function searchTermWhere(term: string): Prisma.UserWhereInput {
  const contains: Prisma.StringFilter = { contains: term, mode: 'insensitive' };
  return {
    OR: [
      { firstName: contains },
      { lastName: contains },
      { email: contains },
      { agent: { is: { agentId: contains } } },
    ],
  };
}

export function agentListWhere(
  query: AdminAgentQueryDto,
  now: Date = new Date(),
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (query.status) {
    and.push(statusWhere(query.status, now));
  }
  if (query.stateId) {
    and.push(locationWhere({ stateId: query.stateId }));
  }
  if (query.lgaId) {
    and.push(locationWhere({ lgaId: query.lgaId }));
  }
  const terms = query.search?.split(/\s+/).filter(Boolean) ?? [];
  and.push(...terms.map(searchTermWhere));
  return { role: Role.EXTENSION_AGENT, AND: and };
}
