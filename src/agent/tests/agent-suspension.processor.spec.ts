import type { Queue } from 'bullmq';
import { AdminAgentService } from '../admin-agent.service';
import {
  AgentSuspensionProcessor,
  AgentSuspensionScheduler,
} from '../agent-suspension.processor';

describe('AgentSuspensionProcessor', () => {
  it('ends expired suspensions and reports how many', async () => {
    const service = { endExpiredSuspensions: jest.fn().mockResolvedValue(3) };
    const processor = new AgentSuspensionProcessor(
      service as unknown as AdminAgentService,
    );

    await expect(processor.process()).resolves.toEqual({ ended: 3 });
    expect(service.endExpiredSuspensions).toHaveBeenCalledTimes(1);
  });
});

describe('AgentSuspensionScheduler', () => {
  it('upserts a five-minute schedule on boot', async () => {
    const queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new AgentSuspensionScheduler(queue as unknown as Queue);

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'end-expired-agent-suspensions',
      { every: 5 * 60 * 1000 },
      { name: 'end-expired-agent-suspensions' },
    );
  });
});
