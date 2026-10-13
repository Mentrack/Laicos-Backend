import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PAYSTACK_EVENTS_QUEUE, type PaystackEvent } from './paystack-events';
import { PaystackEventsService } from './paystack-events.service';

@Processor(PAYSTACK_EVENTS_QUEUE)
export class PaystackEventsProcessor extends WorkerHost {
  constructor(private readonly events: PaystackEventsService) {
    super();
  }

  process(job: Job<PaystackEvent>): Promise<void> {
    return this.events.handle(job.data);
  }
}
