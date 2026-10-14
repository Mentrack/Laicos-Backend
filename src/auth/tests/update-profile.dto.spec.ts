import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from '../dto';

async function errors(body: object) {
  return (
    await validate(plainToInstance(UpdateProfileDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((error) => error.property);
}

describe('UpdateProfileDto', () => {
  it('accepts a partial update and trims names', async () => {
    const dto = plainToInstance(UpdateProfileDto, { firstName: ' Ada ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.firstName).toBe('Ada');
  });

  it('accepts lastName and phoneNumber', async () => {
    await expect(
      errors({ lastName: 'Okafor', phoneNumber: '+2348012345678' }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['firstName', '   '],
    ['lastName', ''],
    ['phoneNumber', '  '],
  ])('rejects empty %s', async (field, value) => {
    await expect(errors({ [field]: value })).resolves.toContain(field);
  });

  it('refuses email: that is the login identity', async () => {
    await expect(
      errors({ firstName: 'Ada', email: 'new@example.com' }),
    ).resolves.toContain('email');
  });
});
