import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyEmailDto } from '../dto';

async function errorsFor(code: string) {
  const dto = plainToInstance(VerifyEmailDto, {
    email: 'ada@example.com',
    code,
  });
  return (await validate(dto)).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );
}

describe('VerifyEmailDto', () => {
  it('accepts four digits, leading zeros included', async () => {
    await expect(errorsFor('0042')).resolves.toEqual([]);
  });

  it.each(['123', '12345', '12a4', ' 1234'])('rejects %p', async (code) => {
    await expect(errorsFor(code)).resolves.toEqual(['code must be 4 digits']);
  });
});
