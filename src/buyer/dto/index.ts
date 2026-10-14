import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { LgaDto, StateDto } from '../../location/dto';

export class BuyerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BY-000123', description: 'Public buyer code' })
  buyerId: string;
}

export class BuyerProfileDto extends BuyerDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ type: StateDto, nullable: true })
  state: StateDto | null;

  @ApiProperty({ type: LgaDto, nullable: true })
  lga: LgaDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class UpdateBuyerDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Send with stateId; either alone is 400',
  })
  @IsOptional()
  @IsUUID()
  lgaId?: string;
}
