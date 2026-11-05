import { ApiProperty } from '@nestjs/swagger';
import {
  DeliveryStatus,
  NotificationChannel,
  NotificationType,
  Role,
} from '../../../generated/client';

export class DeliveryUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;
}

export class DeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: NotificationChannel, enumName: 'NotificationChannel' })
  channel: NotificationChannel;

  @ApiProperty({ enum: DeliveryStatus, enumName: 'DeliveryStatus' })
  status: DeliveryStatus;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  type: NotificationType;

  @ApiProperty()
  attempts: number;

  @ApiProperty({ type: String, nullable: true })
  lastError: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: DeliveryUserDto })
  user: DeliveryUserDto;
}
