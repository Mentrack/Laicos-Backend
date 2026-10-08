import type { HttpException } from '@nestjs/common';
import { idempotencyKeyPipe } from '../decorators/idempotency-key.decorator';

const meta = { type: 'custom' as const };

async function errorBody(value: unknown) {
  const error: unknown = await idempotencyKeyPipe()
    .transform(value as string, meta)
    .catch((caught: unknown) => caught);
  return (error as HttpException).getResponse();
}

describe('idempotencyKeyPipe', () => {
  const expected = {
    message: 'Idempotency-Key header must be a UUID',
    code: 'INVALID_IDEMPOTENCY_KEY',
  };

  it('passes a UUID through', async () => {
    const key = '3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';
    await expect(idempotencyKeyPipe().transform(key, meta)).resolves.toBe(key);
  });

  it('names the header when it is missing', async () => {
    await expect(errorBody(undefined)).resolves.toEqual(expected);
  });

  it('names the header when it is not a UUID', async () => {
    await expect(errorBody('retry-1')).resolves.toEqual(expected);
  });
});
