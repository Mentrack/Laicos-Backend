import { ApiProperty } from '@nestjs/swagger';
import { ProduceStatus, ProduceType } from '../../../generated/client';

export class ProduceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty({ example: 'Yellow maize' })
  name: string;

  @ApiProperty({
    example: 500,
    description: 'Original stock listed, in `unit`. Immutable after creation.',
  })
  quantity: number;

  @ApiProperty({
    example: 500,
    description: 'Stock not yet committed to a CONFIRMED order, in `unit`',
  })
  actualQuantity: number;

  @ApiProperty({
    example: 450,
    description: 'Stock still orderable: actual minus PENDING orders',
  })
  floatingQuantity: number;

  @ApiProperty({ example: 'kg' })
  unit: string;

  // Prisma serialises Decimal as a string, which keeps money exact.
  @ApiProperty({ type: String, example: '350.50' })
  pricePerUnit: string;

  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType' })
  type: ProduceType;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
