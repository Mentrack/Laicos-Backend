import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from '../dto';

const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';

const valid = {
  produceId,
  expectedTotal: 3850.5,
  addressId: '5c1a9e60-3d2b-4f7e-8a14-6b9d0c2e7f31',
  deliveryDate: '2026-11-15',
};

async function invalid(quantity: unknown, overrides: object = {}) {
  const dto = plainToInstance(CreateOrderDto, {
    ...valid,
    quantity,
    ...overrides,
  });
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

  it('rejects a missing addressId', async () => {
    await expect(invalid(3, { addressId: undefined })).resolves.toContain(
      'addressId',
    );
  });
});
