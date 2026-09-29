import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VerifiedAgentGuard } from '../guards/verified-agent.guard';

describe('VerifiedAgentGuard', () => {
  const agent = { findUnique: jest.fn() };
  const guard = new VerifiedAgentGuard({ agent } as unknown as PrismaService);
  const request: Record<string, unknown> = { user: { id: 'user-1' } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    delete request.agent;
  });

  it('loads a verified agent onto the request', async () => {
    const row = { id: 'agent-1', isVerified: true };
    agent.findUnique.mockResolvedValue(row);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.agent).toBe(row);
  });

  it.each([
    ['an unverified agent', { id: 'agent-1', isVerified: false }],
    ['a user with no agent profile', null],
  ])('refuses %s', async (_label, row) => {
    agent.findUnique.mockResolvedValue(row);
    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('Agent is not verified'),
    );
    expect(request.agent).toBeUndefined();
  });
});
