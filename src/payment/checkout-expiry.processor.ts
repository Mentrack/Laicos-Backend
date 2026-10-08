import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CheckoutExpiryService } from './checkout-expiry.service';

export const CHECKOUT_EXPIRY_QUEUE = 'checkout-expiry';
const SWEEP_SCHEDULER_ID = 'expire-unpaid-checkouts';
const SWEEP_EVERY_MS = 60 * 1000;

/**
 * A sweep rather than one delayed job per checkout: it survives lost jobs
 * and transfer-hold extensions without rescheduling anything.
 */
@Processor(CHECKOUT_EXPIRY_QUEUE)
export class CheckoutExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(CheckoutExpiryProcessor.name);

  constructor(private readonly expiry: CheckoutExpiryService) {
    super();
  }

  async process(): Promise<{ expired: number }> {
    const expired = await this.expiry.expireOverdue();
    if (expired) {
      this.logger.log(`Expired ${expired} unpaid checkout(s)`);
    }
    return { expired };
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class CheckoutExpiryScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(CHECKOUT_EXPIRY_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_EVERY_MS },
      { name: SWEEP_SCHEDULER_ID },
    );
  }
}
