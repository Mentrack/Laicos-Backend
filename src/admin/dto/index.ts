import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NormalizedEmail } from '../../common/dto/normalized-email';

export class AdminProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'AD-000123', description: 'Public admin code' })
  adminId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class InviteAdminDto {
  @ApiProperty({ example: 'ngozi@laicos.ng' })
  @NormalizedEmail()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Ngozi' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Adeyemi' })
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
}
