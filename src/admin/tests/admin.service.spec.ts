import { Role, type User } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminService } from '../admin.service';

const user = { id: 'user-1', role: Role.ADMIN } as User;
const created = new Date('2026-10-14');

function row() {
  return {
    id: 'admin-1',
    adminId: 'AD-000001',
    userId: user.id,
    createdAt: created,
    updatedAt: created,
  };
}

describe('AdminService', () => {
  const admin = { findUnique: jest.fn() };
  const service = new AdminService({ admin } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    admin.findUnique.mockResolvedValue(row());
  });

  it('returns my profile', async () => {
    await expect(service.findMine(user)).resolves.toEqual(row());
    expect(admin.findUnique).toHaveBeenCalledWith({
      where: { userId: user.id },
    });
  });

  it('404s a user without an admin profile', async () => {
    admin.findUnique.mockResolvedValue(null);
    await expect(service.findMine(user)).rejects.toThrow(
      'Admin profile not found',
    );
  });
});
