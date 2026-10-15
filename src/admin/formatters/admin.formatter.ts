import type { Admin } from '../../../generated/client';
import type { AdminProfileDto } from '../dto';

export function toAdminProfileDto(admin: Admin): AdminProfileDto {
  return {
    id: admin.id,
    adminId: admin.adminId,
    userId: admin.userId,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}
