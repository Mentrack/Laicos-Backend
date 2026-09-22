import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { Role } from '../../../generated/client';

export class RegisterDto {
  @ApiProperty({ example: 'ada@example.com' })
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

  @ApiProperty({
    example: '+2348012345678',
    description: 'Phone number in E.164 format',
  })
  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({
    enum: [Role.FARMER, Role.BUYER, Role.EXTENSION_AGENT, Role.RIDER],
    example: Role.FARMER,
    description: 'Account role. Only FARMER or BUYER may self-register.',
  })
  @IsNotEmpty()
  @IsIn([Role.FARMER, Role.BUYER, Role.EXTENSION_AGENT, Role.RIDER])
  role:
    | typeof Role.FARMER
    | typeof Role.BUYER
    | typeof Role.EXTENSION_AGENT
    | typeof Role.RIDER;
}
