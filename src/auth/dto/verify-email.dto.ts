import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';
import { OTP_LENGTH } from '../utils/email-verification';
import { NormalizedEmail } from '../../common/dto/normalized-email';

export class VerifyEmailDto {
  @ApiProperty({ example: 'ada@example.com' })
  @NormalizedEmail()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '0427', description: 'The code from the email' })
  @Matches(new RegExp(`^\\d{${OTP_LENGTH}}$`), {
    message: `code must be ${OTP_LENGTH} digits`,
  })
  code: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'ada@example.com' })
  @NormalizedEmail()
  @IsEmail()
  email: string;
}
