import { Role } from '../../../generated/client';
import { AgentVerificationStatus } from '../dto';
import { agentListWhere } from '../utils/agent-list-filter';
import {
  currentlySuspendedWhere,
  notCurrentlySuspendedWhere,
} from '../utils/agent-suspension';

const S = '5b1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
const L = '7c2d2d4f-3c9f-4b66-8e1f-4c7c2f1d0b22';

function and(query: Parameters<typeof agentListWhere>[0]) {
  return agentListWhere(query).AND;
}

describe('agentListWhere', () => {
  it('always scopes to agents', () => {
    expect(agentListWhere({})).toEqual({ role: Role.EXTENSION_AGENT, AND: [] });
  });

  it('ONBOARDING means no Agent row', () => {
    expect(and({ status: AgentVerificationStatus.ONBOARDING })).toContainEqual({
      agent: { is: null },
    });
  });

  it('PENDING', () => {
    expect(and({ status: AgentVerificationStatus.PENDING })).toContainEqual({
      agent: { is: { isVerified: false, rejectedAt: null } },
    });
  });

  const now = new Date('2026-11-12T10:00:00.000Z');

  it('VERIFIED excludes currently suspended agents', () => {
    expect(
      agentListWhere({ status: AgentVerificationStatus.VERIFIED }, now).AND,
    ).toContainEqual({
      agent: { is: { isVerified: true, ...notCurrentlySuspendedWhere(now) } },
    });
  });

  it('SUSPENDED means verified and currently suspended', () => {
    expect(
      agentListWhere({ status: AgentVerificationStatus.SUSPENDED }, now).AND,
    ).toContainEqual({
      agent: { is: { isVerified: true, ...currentlySuspendedWhere(now) } },
    });
  });

  it('REJECTED', () => {
    expect(and({ status: AgentVerificationStatus.REJECTED })).toContainEqual({
      agent: { is: { rejectedAt: { not: null } } },
    });
  });

  it('stateId matches the agent, or the application when there is no agent', () => {
    expect(and({ stateId: S })).toContainEqual({
      OR: [
        { agent: { is: { stateId: S } } },
        { agent: { is: null }, application: { is: { stateId: S } } },
      ],
    });
  });

  it('lgaId matches the agent, or the application when there is no agent', () => {
    expect(and({ lgaId: L })).toContainEqual({
      OR: [
        { agent: { is: { lgaId: L } } },
        { agent: { is: null }, application: { is: { lgaId: L } } },
      ],
    });
  });

  it('ANDs stateId and lgaId', () => {
    const entries = and({ stateId: S, lgaId: L });
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({
      OR: [
        { agent: { is: { stateId: S } } },
        { agent: { is: null }, application: { is: { stateId: S } } },
      ],
    });
    expect(entries).toContainEqual({
      OR: [
        { agent: { is: { lgaId: L } } },
        { agent: { is: null }, application: { is: { lgaId: L } } },
      ],
    });
  });

  it('search splits on whitespace and ANDs the terms', () => {
    const entries = and({ search: '  mark   ok ' });
    expect(entries).toHaveLength(2);
    for (const term of ['mark', 'ok']) {
      const contains = { contains: term, mode: 'insensitive' };
      expect(entries).toContainEqual({
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
          { agent: { is: { agentId: contains } } },
        ],
      });
    }
  });
});
