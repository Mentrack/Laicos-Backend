import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Currency } from '../../../generated/client';

export class InitiatePaymentDto {
  @ApiProperty({
    enum: Currency,
    enumName: 'Currency',
    description: 'USD is charged by card only, at the rate from GET /fx/rate',
  })
  @IsEnum(Currency)
  currency: Currency;
}
