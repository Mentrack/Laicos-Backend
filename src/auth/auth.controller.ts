import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '../../generated/client';
import { ApiEnvelope, MessageResponseDto } from '../common/dto/envelope';
import { AuthService } from './auth.service';
import { Auth } from './decorators/auth.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  AuthSessionDto,
  ChangePasswordDto,
  ConfirmForgotPasswordDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  GoogleRegisterDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  TokenPairDto,
  UserDto,
} from './dto';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register with email and password',
    description:
      'Creates the Firebase account and the local user, and signs them in. Registering as FARMER or EXTENSION_AGENT also creates that profile.',
  })
  @ApiEnvelope(AuthSessionDto, { status: HttpStatus.CREATED })
  async register(@Body() dto: RegisterDto) {
    const data = await this.auth.register(dto);
    return { data, message: 'User registered' };
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(AuthSessionDto)
  async login(@Body() dto: LoginDto) {
    const data = await this.auth.login(dto);
    return { data, message: 'Login successful' };
  }

  @Post('google/register')
  @ApiOperation({
    summary: 'Register with a Google ID token',
    description:
      'Same result as email registration, using the Google account for name and email.',
  })
  @ApiEnvelope(AuthSessionDto, { status: HttpStatus.CREATED })
  async googleRegister(@Body() dto: GoogleRegisterDto) {
    const data = await this.auth.googleRegister(dto);
    return { data, message: 'User registered' };
  }

  // 404 when the Google account isn't registered yet: send the user to
  // POST /auth/google/register with the same idToken.
  @Post('google/login')
  @ApiOperation({
    summary: 'Log in with a Google ID token',
    description:
      '404 when the Google account has not registered yet: send the user to POST /auth/google/register with the same idToken.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(AuthSessionDto)
  async googleLogin(@Body() dto: GoogleLoginDto) {
    const data = await this.auth.googleLogin(dto);
    return { data, message: 'Login successful' };
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(TokenPairDto)
  async refreshToken(@Body() dto: RefreshTokenDto) {
    const data = await this.auth.refreshToken(dto.refreshToken);
    return { data, message: 'Token refreshed' };
  }

  // Same response whether or not the email exists, so it can't be used to
  // enumerate accounts.
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Email a password reset link',
    description:
      'Always answers the same way, whether or not the email has an account.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return {
      data: null,
      message:
        'If an account with that email exists, a password reset link has been sent',
    };
  }

  @Post('forgot-password/confirm')
  @ApiOperation({ summary: 'Set a new password from a reset link code' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async confirmForgotPassword(@Body() dto: ConfirmForgotPasswordDto) {
    await this.auth.confirmForgotPassword(dto);
    return { data: null, message: 'Password reset' };
  }

  @Patch('change-password')
  @ApiOperation({
    summary: 'Change the signed-in user’s password',
    description:
      'Signs the user out of every session; they log in again with the new password.',
  })
  @Auth()
  @ApiOkResponse({ type: MessageResponseDto })
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user, dto);
    return { data: null, message: 'Password changed' };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Log out of every session' })
  @HttpCode(HttpStatus.OK)
  @Auth()
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@CurrentUser() user: User) {
    await this.auth.logout(user);
    return { data: null, message: 'Logged out' };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the signed-in user' })
  @Auth()
  @ApiEnvelope(UserDto)
  async getCurrentUser(@CurrentUser() user: User) {
    const data = await this.auth.getCurrentUser(user);
    return { data, message: 'User retrieved' };
  }
}
