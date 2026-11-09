import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { NormalizedEmail } from '../../common/dto/normalized-email';
import { PaginationQueryDto } from '../../common/pagination';

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
}

export class AcceptAdminInviteDto {
  @ApiProperty({ description: 'The token from the emailed invite link' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'Password1!' })
  @IsNotEmpty()
  @IsString()
  password: string;

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

export class AdminInviteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ngozi@laicos.ng' })
  email: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  acceptedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export enum AdminInviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
}

export class AdminInviteQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AdminInviteStatus })
  @IsOptional()
  @IsEnum(AdminInviteStatus)
  status?: AdminInviteStatus;
}
