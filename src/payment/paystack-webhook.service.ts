import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { isRecord } from '../common/narrow';
import { PaystackClient } from '../paystack/paystack.client';
import { PAYSTACK_EVENTS_QUEUE, type PaystackEvent } from './paystack-events';

@Injectable()
export class PaystackWebhookService {
  constructor(
    private readonly paystack: PaystackClient,
    @InjectQueue(PAYSTACK_EVENTS_QUEUE)
    private readonly queue: Queue<PaystackEvent>,
  ) {}

  /** Checks the signature and queues the event; the worker does the rest. */
  async enqueue(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (!rawBody || !this.paystack.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException({
        message: 'Invalid Paystack signature',
        code: 'INVALID_SIGNATURE',
      });
    }
    const event = parseEvent(rawBody);
    if (!event) {
      throw new BadRequestException({
        message: 'Unreadable Paystack event',
        code: 'INVALID_EVENT',
      });
    }
    // Paystack retries with the same body, so its hash collapses the retries
    // into one job. Not `<event>:<id>`: BullMQ refuses ':' in custom ids.
    await this.queue.add(event.event, event, {
      jobId: createHash('sha256').update(rawBody).digest('hex'),
    });
  }
}

function parseEvent(rawBody: Buffer): PaystackEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  if (
    !isRecord(body) ||
    typeof body.event !== 'string' ||
    !isRecord(body.data)
  ) {
    return null;
  }
  return { event: body.event, data: body.data };
}
