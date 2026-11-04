import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '../../../generated/client';

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  type: NotificationType;

  @ApiProperty({ example: 'New order' })
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Deep-link target, e.g. { resource, resourceId }.',
  })
  data: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
