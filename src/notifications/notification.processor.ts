import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { DeliveryService } from './delivery.service';
import {
  DeliverJobData,
  NOTIFICATIONS_QUEUE,
  SWEEP_JOB,
} from './notification-queue';

const SWEEP_SCHEDULER_ID = 'sweep-notification-deliveries';
const SWEEP_EVERY_MS = 5 * 60 * 1000;
// Per instance. Higher buys little: Gmail allows about 2.5 sends a second per
// account, and its 429s just retry with backoff.
const CONCURRENCY = 5;

@Processor(NOTIFICATIONS_QUEUE, { concurrency: CONCURRENCY })
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly deliveries: DeliveryService) {
    super();
  }

  async process(job: Job<DeliverJobData>): Promise<void> {
    if (job.name === SWEEP_JOB) {
      const requeued = await this.deliveries.sweep();
      if (requeued) {
        this.logger.log(`Re-enqueued ${requeued} stale notification(s)`);
      }
      return;
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.deliveries.deliver(job.data.deliveryId, finalAttempt);
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class NotificationSweepScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_EVERY_MS },
      { name: SWEEP_JOB },
    );
  }
}
