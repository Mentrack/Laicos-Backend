import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Cursors, not pages: a new message would shift every page boundary and the
// client would see duplicates or gaps.
export class MessageQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Messages older than this one. Not with after.',
  })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Messages newer than this one, e.g. to catch up after a reconnect. Not with before.',
  })
  @IsOptional()
  @IsUUID()
  after?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 30;
}
