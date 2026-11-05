import type { Notification } from '../../../generated/client';
import { isRecord } from '../../common/narrow';
import type { NotificationDto } from '../dto/notification.dto';

export function formatNotification(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: isRecord(row.data) ? row.data : null,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
