import type { AdminInvite } from '../../../generated/client';
import type { AdminInviteDto } from '../dto';

export function toAdminInviteDto(row: AdminInvite): AdminInviteDto {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}
