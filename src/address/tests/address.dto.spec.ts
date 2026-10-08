import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto, UpdateAddressDto } from '../dto';

const valid = {
  label: ' Warehouse A ',
  street: '12, Bompai Industrial Area',
  stateId: '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22',
  lgaId: '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b',
};

async function errors<T extends object>(cls: new () => T, body: object) {
  const found = await validate(plainToInstance(cls, body));
  return found.map((error) => error.property);
}

describe('address DTOs', () => {
  it('accepts and trims a valid address', async () => {
    const dto = plainToInstance(CreateAddressDto, valid);
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.label).toBe('Warehouse A');
  });

  it.each([
    ['label', '   '],
    ['label', 'x'.repeat(61)],
    ['street', ''],
    ['stateId', 'kano'],
    ['contactPhone', 'x'.repeat(21)],
  ])('rejects %s=%p', async (field, value) => {
    await expect(
      errors(CreateAddressDto, { ...valid, [field]: value }),
    ).resolves.toContain(field);
  });

  it('allows a partial update', async () => {
    await expect(errors(UpdateAddressDto, { label: 'Home' })).resolves.toEqual(
      [],
    );
  });

  it('refuses isDefault=false', async () => {
    await expect(
      errors(UpdateAddressDto, { isDefault: false }),
    ).resolves.toContain('isDefault');
  });
});
