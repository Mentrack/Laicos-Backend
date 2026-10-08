import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import { Equals, IsNotEmpty, IsString } from 'class-validator';
import { GoogleLoginDto, RegisterDto, UserDto } from '../../auth/dto';
import { UpdateIdentityDto } from '../../common/dto/identity.dto';
import { CreateFarmDto, MultipartBoolean } from './create-farm.dto';
import { FarmDto } from './farm.dto';
import { FarmerDto } from './farmer.dto';

/** What every password-less signup (farmer, agent) asks of the person. */
export class SignupContactDto {
  @ApiProperty({
    example: '+2348012345678',
    description: 'Phone number in E.164 format',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: true, description: 'Must be true' })
  @MultipartBoolean()
  @Equals(true, { message: 'You must agree to the terms' })
  agreedToTerms: boolean;
}

// Multipart, like CreateFarmDto: `name` is the farm's name. The documents
// travel as files beside these fields.
class FarmerSignupFieldsDto extends IntersectionType(
  CreateFarmDto,
  UpdateIdentityDto,
  SignupContactDto,
) {}

export class FarmerSignupDto extends IntersectionType(
  FarmerSignupFieldsDto,
  PickType(RegisterDto, ['email', 'firstName', 'lastName'] as const),
) {}

/** Google supplies the name and email. */
export class GoogleFarmerSignupDto extends IntersectionType(
  FarmerSignupFieldsDto,
  GoogleLoginDto,
) {}

export class RegisteredFarmerDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ type: FarmerDto })
  farmer: FarmerDto;

  @ApiProperty({ type: FarmDto })
  farm: FarmDto;
}
