import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PayeeRole, PayoutStatus } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class PayoutQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PayoutStatus, enumName: 'PayoutStatus' })
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  @ApiPropertyOptional({ enum: PayeeRole, enumName: 'PayeeRole' })
  @IsOptional()
  @IsEnum(PayeeRole)
  payeeRole?: PayeeRole;
}
