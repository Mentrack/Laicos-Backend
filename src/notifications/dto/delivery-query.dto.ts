import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DeliveryStatus } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class DeliveryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: DeliveryStatus,
    enumName: 'DeliveryStatus',
    default: DeliveryStatus.FAILED,
  })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus = DeliveryStatus.FAILED;
}
