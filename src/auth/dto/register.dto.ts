import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { Role } from '../../../generated/client';
import { NormalizedEmail } from '../../common/dto/normalized-email';

export class RegisterDto {
  @ApiProperty({ example: 'ada@example.com' })
  @NormalizedEmail()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Password1!' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty({ example: 'Ada', description: 'User first name' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Okafor', description: 'User last name' })
  @IsNotEmpty()
  @IsString()
  lastName: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'Phone number in E.164 format',
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({
    enum: [Role.BUYER, Role.RIDER],
    example: Role.BUYER,
    description:
      'Account role. Farmers and extension agents sign up through POST /farmers/signup and POST /agents/signup instead: they get no password until they are verified.',
  })
  @IsNotEmpty()
  @IsIn([Role.BUYER, Role.RIDER])
  role: typeof Role.BUYER | typeof Role.RIDER;
}
