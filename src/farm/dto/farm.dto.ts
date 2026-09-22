import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
