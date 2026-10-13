import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class CreateRefundDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "A CANCELLED order on this payment: refunds its price plus its share of the service fee. Omit to refund the payment's remaining balance.",
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({ example: 'Farmer could not fulfil the order' })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
