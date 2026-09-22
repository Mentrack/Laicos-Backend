import { ApiProperty } from '@nestjs/swagger';

export class FarmerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'FRM-000123', description: 'Public farmer code' })
  farmerId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
