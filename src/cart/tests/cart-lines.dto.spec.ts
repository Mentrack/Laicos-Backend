import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CartLinesDto } from '../dto';

// Mirrors the global pipe in main.ts.
const pipeOptions = { whitelist: true, forbidNonWhitelisted: true };
const id = (n: number) =>
  `0b7f5a52-6f3c-4f1e-9a57-${n.toString().padStart(12, '0')}`;

async function errorsFor(body: unknown) {
  return validate(plainToInstance(CartLinesDto, body), pipeOptions);
}

describe('CartLinesDto', () => {
  it('accepts up to 50 distinct lines', async () => {
    const items = Array.from({ length: 50 }, (_, n) => ({
      produceId: id(n),
      quantity: 1,
    }));
    await expect(errorsFor({ items })).resolves.toEqual([]);
  });

  it('rejects an empty cart', async () => {
    expect(await errorsFor({ items: [] })).toHaveLength(1);
  });

  it('rejects more than 50 lines', async () => {
    const items = Array.from({ length: 51 }, (_, n) => ({
      produceId: id(n),
      quantity: 1,
    }));
    expect(await errorsFor({ items })).toHaveLength(1);
  });

  it('rejects the same produce twice', async () => {
    const errors = await errorsFor({
      items: [
        { produceId: id(1), quantity: 1 },
        { produceId: id(1), quantity: 2 },
      ],
    });
    expect(errors[0].constraints).toHaveProperty('arrayUnique');
  });

  it('validates each line', async () => {
    const errors = await errorsFor({
      items: [{ produceId: 'not-a-uuid', quantity: 0 }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('items');
  });

  it('rejects unknown fields on a line', async () => {
    const errors = await errorsFor({
      items: [{ produceId: id(1), quantity: 1, price: 1 }],
    });
    expect(errors).toHaveLength(1);
  });
});
