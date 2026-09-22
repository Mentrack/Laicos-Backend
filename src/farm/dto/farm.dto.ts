import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FarmDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Farmer.id of the owner' })
  ownerId: string;

  @ApiProperty({ example: 'Green Acres' })
  name: string;

  @ApiProperty({ example: 'Ogbomosho, Oyo State' })
  location: string;

  @ApiProperty({ example: 2.5, description: 'Size in hectares' })
  size: number;

  @ApiProperty({ example: 'ha' })
  unit: string;

  @ApiProperty({ example: 'Maize' })
  mainProduce: string;

  @ApiProperty()
  isExporting: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Referring agent' })
  referralAgentId?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
