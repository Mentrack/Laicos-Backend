import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PayoutConfig } from './payout.config';
import { PayoutRunService } from './payout-run.service';

export const PAYOUTS_QUEUE = 'payouts';
const RUN_SCHEDULER_ID = 'run-payouts';

// Concurrency 1 keeps two runs in one process from overlapping; the payee
// locks cover several instances.
@Processor(PAYOUTS_QUEUE, { concurrency: 1 })
export class PayoutRunProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutRunProcessor.name);

  constructor(private readonly runs: PayoutRunService) {
    super();
  }

  async process(): Promise<{ payouts: number }> {
    const result = await this.runs.run();
    if (result.payouts) {
      this.logger.log(`Created ${result.payouts} payout(s)`);
    }
    return result;
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class PayoutRunScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PAYOUTS_QUEUE) private readonly queue: Queue,
    private readonly config: PayoutConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RUN_SCHEDULER_ID,
      { every: this.config.runMinutes * 60_000 },
      { name: RUN_SCHEDULER_ID },
    );
  }
}
