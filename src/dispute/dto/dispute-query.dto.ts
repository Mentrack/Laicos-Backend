import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DisputeStatus } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class DisputeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DisputeStatus, enumName: 'DisputeStatus' })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}
