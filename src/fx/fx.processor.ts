import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { FxService } from './fx.service';

export const FX_QUEUE = 'fx-rates';
const FETCH_SCHEDULER_ID = 'fetch-fx-rate';
const FETCH_EVERY_MS = 3_600_000;

@Processor(FX_QUEUE)
export class FxProcessor extends WorkerHost {
  constructor(private readonly fx: FxService) {
    super();
  }

  async process(): Promise<void> {
    await this.fx.fetchLatest();
  }
}

/** Upserted on boot, so restarts and multiple instances keep one schedule. */
@Injectable()
export class FxScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(FX_QUEUE) private readonly queue: Queue,
    private readonly fx: FxService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      FETCH_SCHEDULER_ID,
      { every: FETCH_EVERY_MS },
      { name: FETCH_SCHEDULER_ID },
    );
    // Without a rate, USD payments would be refused until the first run.
    if (!(await this.fx.hasRate())) {
      await this.queue.add(FETCH_SCHEDULER_ID, {});
    }
  }
}
