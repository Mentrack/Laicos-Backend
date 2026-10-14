import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MessageQueryDto, SendMessageDto } from '../dto';

const valid = {
  body: '  Can the cassava come in 50kg sacks?  ',
  clientMessageId: '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22',
};

async function errors<T extends object>(cls: new () => T, body: object) {
  const found = await validate(plainToInstance(cls, body));
  return found.map((error) => error.property);
}

describe('conversation DTOs', () => {
  it('accepts and trims a message', async () => {
    const dto = plainToInstance(SendMessageDto, valid);
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.body).toBe('Can the cassava come in 50kg sacks?');
  });

  it('accepts a 2000-character body', async () => {
    await expect(
      errors(SendMessageDto, { ...valid, body: 'x'.repeat(2000) }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['body', '   '],
    ['body', ''],
    ['body', 'x'.repeat(2001)],
    ['body', 42],
    ['clientMessageId', 'not-a-uuid'],
  ])('rejects %s=%p', async (field, value) => {
    await expect(
      errors(SendMessageDto, { ...valid, [field]: value }),
    ).resolves.toContain(field);
  });

  it('defaults the page size to 30', () => {
    expect(plainToInstance(MessageQueryDto, {}).limit).toBe(30);
  });

  it.each([
    ['limit', '0'],
    ['limit', '51'],
    ['before', 'nope'],
    ['after', 'nope'],
  ])('rejects query %s=%p', async (field, value) => {
    await expect(
      errors(MessageQueryDto, { [field]: value }),
    ).resolves.toContain(field);
  });
});
