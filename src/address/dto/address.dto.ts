import { ApiProperty } from '@nestjs/swagger';

export class AddressPlaceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Kano' })
  name: string;
}

export class AddressDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Warehouse A' })
  label: string;

  @ApiProperty({ example: '12, Bompai Industrial Area' })
  street: string;

  @ApiProperty({ type: AddressPlaceDto })
  state: AddressPlaceDto;

  @ApiProperty({ type: AddressPlaceDto })
  lga: AddressPlaceDto;

  @ApiProperty({ type: String, nullable: true })
  contactName: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactPhone: string | null;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  createdAt: Date;
}
