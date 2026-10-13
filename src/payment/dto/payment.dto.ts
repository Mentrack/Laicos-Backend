import { ApiProperty } from '@nestjs/swagger';
import { Currency, PaymentStatus } from '../../../generated/client';

export class PaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'PAY-000123',
    description: 'Also the Paystack transaction reference',
  })
  reference: string;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status: PaymentStatus;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency: Currency;

  @ApiProperty({
    type: String,
    example: '57500.00',
    description: 'The checkout total in NGN',
  })
  amount: string;

  @ApiProperty({
    type: String,
    example: '37.58',
    description: 'What the buyer is charged, in currency',
  })
  chargedAmount: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1530.123456',
    description: 'NGN per USD used for a USD payment; null for NGN',
  })
  fxRate: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'card',
    description: 'How the buyer paid, once Paystack reports it',
  })
  channel: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Paystack's hosted payment page: redirect the buyer here",
  })
  authorizationUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "For Paystack's inline popup instead of the redirect",
  })
  accessCode: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureReason: string | null;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}
