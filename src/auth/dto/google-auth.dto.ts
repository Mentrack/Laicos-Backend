import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { RegisterDto } from './register.dto';

/** Body of `POST /auth/google/login`. */
export class GoogleLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
    description: 'Google ID token from Google Identity Services',
  })
  @IsNotEmpty()
  @IsString()
  idToken: string;
}

/** Body of `POST /auth/google/register`: Google supplies the name and email. */
export class GoogleRegisterDto extends IntersectionType(
  GoogleLoginDto,
  PickType(RegisterDto, ['role', 'phoneNumber'] as const),
) {}
