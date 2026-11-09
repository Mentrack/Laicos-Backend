import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptAdminInviteDto } from '../dto';

const valid = {
  token: 'raw-token',
  password: 'Password1!',
  firstName: 'Ngozi',
  lastName: 'Adeyemi',
};

describe('AcceptAdminInviteDto', () => {
  it('accepts a complete body', async () => {
    const dto = plainToInstance(AcceptAdminInviteDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['token', 'password'] as const)(
    'rejects a missing %s',
    async (key) => {
      const { [key]: _omitted, ...body } = valid;
      const dto = plainToInstance(AcceptAdminInviteDto, body);
      const errors = await validate(dto);
      expect(errors.map((error) => error.property)).toEqual([key]);
    },
  );
});
