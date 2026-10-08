import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class OrderLineDto {
  @ApiProperty({ format: 'uuid', description: 'A PUBLISHED produce' })
  @IsUUID()
  produceId: string;

  // Produce is sold in whole units: no one buys half a tuber.
  @ApiProperty({
    type: 'integer',
    example: 50,
    description: "Whole units of the produce's `unit`",
  })
  @IsInt()
  @IsPositive()
  quantity: number;
}
