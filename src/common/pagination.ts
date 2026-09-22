import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number = 20;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  perPage: number;

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

/** `skip`/`take` spread straight into `findMany`. */
export function resolvePagination({
  page = 1,
  perPage = 20,
}: PaginationQueryDto) {
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function paginationMeta(
  page: number,
  perPage: number,
  total: number,
): PaginationMetaDto {
  return { page, perPage, total, totalPages: Math.ceil(total / perPage) };
}
