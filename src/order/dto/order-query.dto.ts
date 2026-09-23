import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { OrderStatus, ProduceType } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

/** Filters shared by the order list and the order count. */
export class OrderFilterDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  produceId?: string;

  @ApiPropertyOptional({ enum: OrderStatus, enumName: 'OrderStatus' })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    enum: ProduceType,
    enumName: 'ProduceType',
    description: 'Local or export order',
  })
  @IsOptional()
  @IsEnum(ProduceType)
  type?: ProduceType;
}

export class OrderQueryDto extends IntersectionType(
  OrderFilterDto,
  PaginationQueryDto,
) {}
