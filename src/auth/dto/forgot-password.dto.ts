import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { NormalizedEmail } from '../../common/dto/normalized-email';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ada@example.com' })
  @NormalizedEmail()
  @IsEmail()
  email: string;
}
