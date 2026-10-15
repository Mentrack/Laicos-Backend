import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
} from 'class-validator';
import { BuyerType, Role } from '../../../generated/client';
import { BuyerKindConstraint } from '../../buyer/utils/buyer-kind';
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
      'Account role. Farmers and extension agents sign up through POST /farmers/signup and POST /agents/signup. Admins are invited through POST /admins.',
  })
  @IsNotEmpty()
  @IsIn([Role.BUYER, Role.RIDER])
  @Validate(BuyerKindConstraint)
  role: typeof Role.BUYER | typeof Role.RIDER;

  @ApiPropertyOptional({ enum: BuyerType, enumName: 'BuyerType' })
  @ValidateIf((dto: RegisterDto) => dto.role === Role.BUYER)
  @IsEnum(BuyerType)
  buyerType?: BuyerType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentTerms?: string;
}
