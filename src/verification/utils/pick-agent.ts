export interface AgentCandidate {
  id: string;
  createdAt: Date;
  /** Farms already in the agent's cluster. */
  clusterSize: number;
  /** Rounds the agent holds that are ASSIGNED or IN_PROGRESS. */
  openTasks: number;
}

/**
 * The agent to assign a round to: `preferredId` when it is still a
 * candidate (a resubmission returns to its previous agent), otherwise the
 * smallest cluster, then the fewest open tasks, then the earliest
 * registration, so the choice is deterministic.
 */
export function pickAgent(
  candidates: AgentCandidate[],
  preferredId?: string | null,
): string | null {
  if (preferredId && candidates.some(({ id }) => id === preferredId)) {
    return preferredId;
  }
  const [first] = [...candidates].sort(
    (a, b) =>
      a.clusterSize - b.clusterSize ||
      a.openTasks - b.openTasks ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return first?.id ?? null;
}
