import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from '../dto';

const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';

async function invalid(quantity: unknown) {
  const dto = plainToInstance(CreateOrderDto, { produceId, quantity });
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('CreateOrderDto', () => {
  it('accepts a whole quantity', async () => {
    await expect(invalid(3)).resolves.toEqual([]);
  });

  it('rejects a fractional quantity: no one buys half a tuber', async () => {
    await expect(invalid(2.5)).resolves.toContain('quantity');
  });

  it('rejects zero', async () => {
    await expect(invalid(0)).resolves.toContain('quantity');
  });
});
