import { pickAgent, type AgentCandidate } from '../utils/pick-agent';

function agent(
  id: string,
  clusterSize: number,
  openTasks = 0,
  createdAt = '2026-01-01',
): AgentCandidate {
  return { id, clusterSize, openTasks, createdAt: new Date(createdAt) };
}

describe('pickAgent', () => {
  it('returns null with no candidates', () => {
    expect(pickAgent([])).toBeNull();
  });

  it('picks the smallest cluster', () => {
    expect(pickAgent([agent('a', 5), agent('b', 2), agent('c', 9)])).toBe('b');
  });

  it('breaks a cluster-size tie on open tasks, then registration', () => {
    expect(pickAgent([agent('a', 2, 3), agent('b', 2, 1)])).toBe('b');
    expect(
      pickAgent([
        agent('a', 2, 1, '2026-03-01'),
        agent('b', 2, 1, '2026-02-01'),
      ]),
    ).toBe('b');
  });

  it('prefers the given agent while they are still a candidate', () => {
    expect(pickAgent([agent('a', 1), agent('b', 9)], 'b')).toBe('b');
  });

  it('falls back to the rule when the preferred agent is not a candidate', () => {
    expect(pickAgent([agent('a', 1), agent('b', 9)], 'gone')).toBe('a');
  });
});
