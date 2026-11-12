import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InviteByEmailDto } from '../dto';

describe('InviteByEmailDto', () => {
  it('lowercases the email and needs nothing else', async () => {
    const dto = plainToInstance(InviteByEmailDto, {
      email: '  New@Laicos.test ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('new@laicos.test');
  });

  it('refuses a malformed email', async () => {
    const dto = plainToInstance(InviteByEmailDto, { email: 'nope' });
    const [error] = await validate(dto);
    expect(error?.property).toBe('email');
  });

  it('rejects a name field', async () => {
    const dto = plainToInstance(InviteByEmailDto, {
      email: 'new@laicos.test',
      firstName: 'Ngozi',
    });
    const [error] = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(error?.property).toBe('firstName');
  });
});
