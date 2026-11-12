import type { Invite } from '../../../generated/client';
import type { InviteDto } from '../dto';

export function toInviteDto(row: Invite): InviteDto {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}
