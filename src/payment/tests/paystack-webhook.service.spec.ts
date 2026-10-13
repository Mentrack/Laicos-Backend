import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { PaystackClient } from '../../paystack/paystack.client';
import type { PaystackEvent } from '../paystack-events';
import { PaystackWebhookService } from '../paystack-webhook.service';

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('PaystackWebhookService', () => {
  const paystack = { verifySignature: jest.fn() };
  const queue = { add: jest.fn() };
  const service = new PaystackWebhookService(
    paystack as unknown as PaystackClient,
    queue as unknown as Queue<PaystackEvent>,
  );
  const body = Buffer.from(
    JSON.stringify({
      event: 'charge.success',
      data: { reference: 'PAY-000001' },
    }),
  );

  beforeEach(() => {
    jest.resetAllMocks();
    paystack.verifySignature.mockReturnValue(true);
  });

  it('queues a signed event, keyed by the hash of its body', async () => {
    await service.enqueue(body, 'sig');
    expect(paystack.verifySignature).toHaveBeenCalledWith(body, 'sig');
    expect(queue.add).toHaveBeenCalledWith(
      'charge.success',
      { event: 'charge.success', data: { reference: 'PAY-000001' } },
      { jobId: createHash('sha256').update(body).digest('hex') },
    );
  });

  it('401s a bad signature and queues nothing', async () => {
    paystack.verifySignature.mockReturnValue(false);
    await expect(
      errorBody(service.enqueue(body, 'bad')),
    ).resolves.toMatchObject({
      code: 'INVALID_SIGNATURE',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('401s a request with no raw body', async () => {
    await expect(
      errorBody(service.enqueue(undefined, 'sig')),
    ).resolves.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it.each([
    ['not JSON', Buffer.from('nope')],
    ['without an event', Buffer.from(JSON.stringify({ data: {} }))],
    ['without data', Buffer.from(JSON.stringify({ event: 'x' }))],
  ])('400s a signed body %s', async (_label, raw) => {
    await expect(errorBody(service.enqueue(raw, 'sig'))).resolves.toMatchObject(
      {
        code: 'INVALID_EVENT',
      },
    );
  });
});
