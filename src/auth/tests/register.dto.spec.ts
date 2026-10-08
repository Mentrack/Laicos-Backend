import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../../../generated/client';
import { RegisterDto } from '../dto';

const body = {
  email: 'ada@example.com',
  password: 'Password1!',
  firstName: 'Ada',
  lastName: 'Okafor',
};

describe('RegisterDto', () => {
  it('accepts a buyer', async () => {
    const dto = plainToInstance(RegisterDto, { ...body, role: Role.BUYER });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('refuses a farmer, who signs up through /farmers/signup', async () => {
    const dto = plainToInstance(RegisterDto, { ...body, role: Role.FARMER });
    const [error] = await validate(dto);
    expect(error?.property).toBe('role');
  });

  it('refuses an extension agent, who signs up through /agents/signup', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...body,
      role: Role.EXTENSION_AGENT,
    });
    const [error] = await validate(dto);
    expect(error?.property).toBe('role');
  });
});
