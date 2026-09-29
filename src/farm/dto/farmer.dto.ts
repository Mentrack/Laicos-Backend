import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import { IdentityDto } from '../../common/dto/identity.dto';

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

/** The farmer's own profile: FarmerDto plus their ID, never shown to others. */
export class FarmerProfileDto extends IntersectionType(
  FarmerDto,
  IdentityDto,
) {}
