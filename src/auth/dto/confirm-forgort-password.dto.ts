import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ConfirmForgotPasswordDto {
  @ApiProperty({
    description: 'The oobCode query param from the password reset email link',
  })
  @IsNotEmpty()
  @IsString()
  oobCode: string;

  @ApiProperty({ example: 'NewPassword1!' })
  @IsString()
  @MinLength(1)
  newPassword: string;
}
