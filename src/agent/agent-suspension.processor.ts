import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AdminAgentService } from './admin-agent.service';

export const AGENT_SUSPENSION_QUEUE = 'agent-suspension';
const SWEEP_SCHEDULER_ID = 'end-expired-agent-suspensions';
const SWEEP_EVERY_MS = 5 * 60 * 1000;

/**
 * A sweep rather than one delayed job per suspension: the guards read the end
 * date directly, and unsuspending then re-suspending would leave stale delayed
 * jobs behind.
 */
@Processor(AGENT_SUSPENSION_QUEUE)
export class AgentSuspensionProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentSuspensionProcessor.name);

  constructor(private readonly agents: AdminAgentService) {
    super();
  }

  async process(): Promise<{ ended: number }> {
    const ended = await this.agents.endExpiredSuspensions();
    if (ended) {
      this.logger.log(`Ended ${ended} expired agent suspension(s)`);
    }
    return { ended };
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class AgentSuspensionScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(AGENT_SUSPENSION_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_EVERY_MS },
      { name: SWEEP_SCHEDULER_ID },
    );
  }
}
