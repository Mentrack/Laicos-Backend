import { OmitType } from '@nestjs/swagger';
import { RegisterDto } from './register.dto';

/**
 * Service-internal input for the local `User` row, shared by password and
 * Google registration. Not a request body, so it carries no validators.
 */
export class CreateLocalUserDto extends OmitType(RegisterDto, [
  'password',
] as const) {
  firebaseUid: string;
  isVerified: boolean;
  /** Stored in the same write, so no half-created user needs undoing. */
  refreshToken?: string;
}
