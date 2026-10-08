import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CreateAddressDto } from './create-address.dto';

export class UpdateAddressDto extends PartialType(CreateAddressDto) {
  // Only `true`: unsetting would leave the buyer with no default.
  @ApiPropertyOptional({
    enum: [true],
    description: 'Make this the default address',
  })
  @IsOptional()
  @IsIn([true], {
    message:
      'isDefault can only be set to true; make another address the default instead',
  })
  isDefault?: true;
}
