import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProduceStatus, ProduceType } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class ProduceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  @IsOptional()
  @IsEnum(ProduceStatus)
  status?: ProduceStatus;

  @ApiPropertyOptional({ enum: ProduceType, enumName: 'ProduceType' })
  @IsOptional()
  @IsEnum(ProduceType)
  type?: ProduceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  farmId?: string;
}
