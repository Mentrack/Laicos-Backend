import type { Prisma } from '../../../generated/client';

export function isCurrentlySuspended(
  agent: { suspendedAt: Date | null; suspendedUntil: Date | null },
  now: Date = new Date(),
): boolean {
  if (!agent.suspendedAt) return false;
  return agent.suspendedUntil === null || agent.suspendedUntil > now;
}

// Top-level OR: don't spread beside another OR, the later key silently wins.
export function currentlySuspendedWhere(now: Date): Prisma.AgentWhereInput {
  return {
    suspendedAt: { not: null },
    OR: [{ suspendedUntil: null }, { suspendedUntil: { gt: now } }],
  };
}

// Top-level OR: don't spread beside another OR, the later key silently wins.
export function notCurrentlySuspendedWhere(now: Date): Prisma.AgentWhereInput {
  return {
    OR: [{ suspendedAt: null }, { suspendedUntil: { lte: now } }],
  };
}
