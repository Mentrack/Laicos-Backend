import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AssignmentService } from './services/assignment.service';

export const ASSIGNMENT_QUEUE = 'verification-assignment';
const RETRY_SCHEDULER_ID = 'assign-waiting-rounds';
const RETRY_EVERY_MS = 15 * 60 * 1000;

/**
 * Retries rounds left UNASSIGNED because their LGA had no eligible agent.
 * Agents who declined a round are excluded inside assign(), so a round every
 * agent declined only moves once a new agent is verified in its LGA.
 */
@Processor(ASSIGNMENT_QUEUE)
export class AssignmentProcessor extends WorkerHost {
  private readonly logger = new Logger(AssignmentProcessor.name);

  constructor(private readonly assignment: AssignmentService) {
    super();
  }

  async process(): Promise<{ assigned: number }> {
    const assigned = await this.assignment.assignWaiting();
    if (assigned) {
      this.logger.log(`Assigned ${assigned} waiting verification round(s)`);
    }
    return { assigned };
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class AssignmentScheduler implements OnModuleInit {
  constructor(@InjectQueue(ASSIGNMENT_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RETRY_SCHEDULER_ID,
      { every: RETRY_EVERY_MS },
      { name: RETRY_SCHEDULER_ID },
    );
  }
}
