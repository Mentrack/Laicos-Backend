import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '../../generated/client';
import { AllowPendingApplication } from '../auth/decorators/allow-pending-application.decorator';
import { AllowSuspendedFarmer } from '../auth/decorators/allow-suspended-farmer.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope, MessageResponseDto } from '../common/dto/envelope';
import { DeviceService } from './device.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationDto } from './dto/notification.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UnreadCountDto } from './dto/unread-count.dto';
import { InboxService } from './inbox.service';

// Static paths (unread-count, read-all, devices) are declared before the
// parameterised ones so ':id' can never swallow them.
@Controller('notifications')
@ApiTags('Notifications')
export class NotificationController {
  constructor(
    private readonly inbox: InboxService,
    private readonly devices: DeviceService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description: 'Newest first. unread=true limits the list to unread ones.',
  })
  @Auth()
  @ApiEnvelope(NotificationDto, { paginated: true })
  async list(@CurrentUser() user: User, @Query() query: NotificationQueryDto) {
    const { data, metaData } = await this.inbox.list(user.id, query);
    return { data, message: 'Notifications retrieved', metaData };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count my unread notifications' })
  @Auth()
  @ApiEnvelope(UnreadCountDto)
  async unreadCount(@CurrentUser() user: User) {
    return {
      data: await this.inbox.unreadCount(user.id),
      message: 'Unread count retrieved',
    };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications read' })
  @Auth()
  @ApiOkResponse({ type: MessageResponseDto })
  async markAllRead(@CurrentUser() user: User) {
    await this.inbox.markAllRead(user.id);
    return { data: null, message: 'Notifications marked read' };
  }

  @Post('devices')
  @ApiOperation({
    summary: 'Register a push device',
    description:
      'Idempotent on the token: a token already registered to another account moves to the caller.',
  })
  @HttpCode(HttpStatus.OK)
  @Auth()
  @AllowPendingApplication()
  @AllowSuspendedFarmer()
  @ApiOkResponse({ type: MessageResponseDto })
  async registerDevice(
    @CurrentUser() user: User,
    @Body() dto: RegisterDeviceDto,
  ) {
    await this.devices.register(user.id, dto);
    return { data: null, message: 'Device registered' };
  }

  @Delete('devices/:token')
  @ApiOperation({
    summary: 'Unregister a push device',
    description:
      'Succeeds even when the token is not registered to the caller.',
  })
  @Auth()
  @AllowPendingApplication()
  @AllowSuspendedFarmer()
  @ApiOkResponse({ type: MessageResponseDto })
  async unregisterDevice(
    @CurrentUser() user: User,
    @Param('token') token: string,
  ) {
    await this.devices.unregister(user.id, token);
    return { data: null, message: 'Device unregistered' };
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark a notification read',
    description: '404 when it does not exist or belongs to someone else.',
  })
  @Auth()
  @ApiEnvelope(NotificationDto)
  async markRead(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.inbox.markRead(user.id, id),
      message: 'Notification marked read',
    };
  }
}
