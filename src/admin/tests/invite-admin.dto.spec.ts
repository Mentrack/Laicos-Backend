import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InviteAdminDto } from '../dto';

const body = {
  email: '  New@Laicos.test ',
  firstName: 'Ngozi',
  lastName: 'Adeyemi',
  phoneNumber: '+2348012345678',
};

describe('InviteAdminDto', () => {
  it('lowercases the email and keeps an optional phone', async () => {
    const dto = plainToInstance(InviteAdminDto, body);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('new@laicos.test');
  });

  it('accepts a missing phone number', async () => {
    const dto = plainToInstance(InviteAdminDto, {
      email: 'new@laicos.test',
      firstName: 'Ngozi',
      lastName: 'Adeyemi',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('refuses a blank name', async () => {
    const dto = plainToInstance(InviteAdminDto, { ...body, firstName: '' });
    const [error] = await validate(dto);
    expect(error?.property).toBe('firstName');
  });
});
