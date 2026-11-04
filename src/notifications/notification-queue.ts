import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const DELIVER_JOB = 'deliver';
export const SWEEP_JOB = 'sweep';

export interface DeliverJobData {
  deliveryId: string;
}

@Injectable()
export class NotificationQueue {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Throws on Redis errors; the caller decides whether that matters. */
  async enqueue(deliveryIds: string[]): Promise<void> {
    if (deliveryIds.length === 0) return;
    // Concurrent, so a 500-row sweep costs a few round trips, not 1,500.
    await Promise.all(deliveryIds.map((id) => this.removeFinished(id)));
    await this.queue.addBulk(
      deliveryIds.map((deliveryId) => {
        const data: DeliverJobData = { deliveryId };
        return { name: DELIVER_JOB, data, opts: { jobId: deliveryId } };
      }),
    );
  }

  // A failed job stays in Redis for 24h under the same id, and adding it
  // again would silently no-op, so a sweep re-enqueue would never run.
  private async removeFinished(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state === 'failed' || state === 'completed') {
      await job.remove();
    }
  }
}
