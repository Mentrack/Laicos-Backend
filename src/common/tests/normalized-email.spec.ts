import { plainToInstance } from 'class-transformer';
import { Role } from '../../../generated/client';
import {
  ForgotPasswordDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from '../../auth/dto';

describe.each([
  [
    'RegisterDto',
    RegisterDto,
    { password: 'x', firstName: 'A', lastName: 'O', role: Role.BUYER },
  ],
  ['VerifyEmailDto', VerifyEmailDto, { code: '1234' }],
  ['ResendVerificationDto', ResendVerificationDto, {}],
  ['ForgotPasswordDto', ForgotPasswordDto, {}],
] as const)('%s', (_name, Dto, rest) => {
  it('trims and lowercases the email', () => {
    const dto = plainToInstance(Dto, { ...rest, email: '  Ada@Example.COM ' });
    expect(dto.email).toBe('ada@example.com');
  });
});
