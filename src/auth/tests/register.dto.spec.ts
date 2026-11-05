import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BuyerType, Role } from '../../../generated/client';
import { RegisterDto } from '../dto';

const body = {
  email: 'ada@example.com',
  password: 'Password1!',
  firstName: 'Ada',
  lastName: 'Okafor',
};

describe('RegisterDto', () => {
  it('accepts a buyer', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...body,
      role: Role.BUYER,
      buyerType: BuyerType.PERSON,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a farmer', async () => {
    const dto = plainToInstance(RegisterDto, { ...body, role: Role.FARMER });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts an extension agent', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...body,
      role: Role.EXTENSION_AGENT,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('refuses an admin, who is invited by an existing admin', async () => {
    const dto = plainToInstance(RegisterDto, { ...body, role: Role.ADMIN });
    const [error] = await validate(dto);
    expect(error?.property).toBe('role');
  });
});
