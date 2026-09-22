import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';

/** Body of `POST /auth/refresh-token`. */
export class TokenPairDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'AMf-vXy1__fake-refresh-token' })
  refreshToken: string;

  @ApiProperty({
    example: '3600',
    description: 'Access token lifetime in seconds, as a string',
  })
  expiresIn: string;
}

/** Tokens plus the user, returned by register and login. */
export class AuthSessionDto extends TokenPairDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;
}
