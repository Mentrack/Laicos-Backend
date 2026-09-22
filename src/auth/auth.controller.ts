import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiEnvelope(AuthSessionDto, { status: HttpStatus.CREATED })
  async register(@Body() dto: RegisterDto) {
    const data = await this.auth.register(dto);
    return { data, message: 'User registered' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(AuthSessionDto)
  async login(@Body() dto: LoginDto) {
    const data = await this.auth.login(dto);
    return { data, message: 'Login successful' };
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(TokenPairDto)
  async refreshToken(@Body() dto: RefreshTokenDto) {
    const data = await this.auth.refreshToken(dto.refreshToken);
    return { data, message: 'Token refreshed' };
  }

  // Same response whether or not the email exists, so it can't be used to
  // enumerate accounts.
  @Post('forgot-password')
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
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async confirmForgotPassword(@Body() dto: ConfirmForgotPasswordDto) {
    await this.auth.confirmForgotPassword(dto);
    return { data: null, message: 'Password reset' };
  }

  @Patch('change-password')
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
  @HttpCode(HttpStatus.OK)
  @Auth()
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@CurrentUser() user: User) {
    await this.auth.logout(user);
    return { data: null, message: 'Logged out' };
  }

  @Get('me')
  @Auth()
  @ApiEnvelope(UserDto)
  async getCurrentUser(@CurrentUser() user: User) {
    const data = await this.auth.getCurrentUser(user);
    return { data, message: 'User retrieved' };
  }
}
