import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SourcingResponseService } from './sourcing-response.service';

export const SOURCING_RESPONSE_QUEUE = 'sourcing-response';
const SWEEP_SCHEDULER_ID = 'expire-unanswered-sourcing';
const SWEEP_EVERY_MS = 60 * 1000;

@Processor(SOURCING_RESPONSE_QUEUE)
export class SourcingResponseProcessor extends WorkerHost {
  private readonly logger = new Logger(SourcingResponseProcessor.name);

  constructor(private readonly response: SourcingResponseService) {
    super();
  }

  async process(): Promise<{ expired: number }> {
    const expired = await this.response.expireOverdue();
    if (expired) {
      this.logger.log(`Returned ${expired} unanswered request(s) to the pool`);
    }
    return { expired };
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class SourcingResponseScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(SOURCING_RESPONSE_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_EVERY_MS },
      { name: SWEEP_SCHEDULER_ID },
    );
  }
}
