import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminInvite, Role, User } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminInviteService } from '../admin-invite.service';
import type { AcceptAdminInviteDto } from '../dto';
import { hashInviteToken } from '../utils/invite-token';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const email = 'new@laicos.test';
const dto: AcceptAdminInviteDto = {
  token: 'raw-token',
  password: 'Password1!',
  firstName: 'Ngozi',
  lastName: 'Adeyemi',
  phoneNumber: '+2348012345678',
};

function invite(overrides: Partial<AdminInvite> = {}): AdminInvite {
  return {
    id: 'invite-1',
    email,
    tokenHash: hashInviteToken(dto.token),
    expiresAt: new Date(NOW.getTime() + 60_000),
    invitedById: 'user-1',
    acceptedAt: null,
    userId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function codeOf(error: unknown): unknown {
  expect(error).toBeInstanceOf(BadRequestException);
  return ((error as BadRequestException).getResponse() as { code?: string })
    .code;
}

describe('AdminInviteService.accept', () => {
  const database = {
    user: { findUnique: jest.fn() },
    adminInvite: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const auth = {
    createFirebaseUser: jest.fn(),
    createLocalUser: jest.fn(),
    deleteFirebaseUser: jest.fn(),
    startSession: jest.fn(),
  };
  const service = new AdminInviteService(
    database as unknown as PrismaService,
    auth as unknown as AuthService,
    {} as MailService,
    {} as ConfigService,
  );
  const created = { id: 'user-2', role: Role.ADMIN } as User;
  const session = {
    user: created,
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: '3600',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    database.user.findUnique.mockResolvedValue(null);
    database.adminInvite.findUnique.mockResolvedValue(invite());
    database.adminInvite.updateMany.mockResolvedValue({ count: 1 });
    database.adminInvite.update.mockResolvedValue(invite());
    database.$transaction.mockImplementation(
      (run: (tx: typeof database) => Promise<unknown>) => run(database),
    );
    auth.createFirebaseUser.mockResolvedValue({ uid: 'fb-1' });
    auth.createLocalUser.mockResolvedValue(created);
    auth.deleteFirebaseUser.mockResolvedValue(undefined);
    auth.startSession.mockResolvedValue(session);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates the admin from the invite and signs them in', async () => {
    const result = await service.accept(dto);

    expect(database.adminInvite.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashInviteToken(dto.token) },
    });
    expect(database.adminInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite-1',
        tokenHash: hashInviteToken(dto.token),
        acceptedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { acceptedAt: NOW },
    });
    // The invite's email, never one from the body: the DTO has no email.
    expect(auth.createFirebaseUser).toHaveBeenCalledWith({
      email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: dto.password,
      emailVerified: true,
    });
    expect(auth.createLocalUser).toHaveBeenCalledWith(
      {
        firebaseUid: 'fb-1',
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        role: Role.ADMIN,
        isVerified: true,
        agreedToTerms: true,
      },
      database,
    );
    expect(database.adminInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { userId: created.id },
    });
    expect(auth.startSession).toHaveBeenCalledWith(created);
    expect(result).toBe(session);
  });

  it('rejects an unknown token with INVITE_INVALID', async () => {
    database.adminInvite.findUnique.mockResolvedValue(null);

    const error = await service.accept(dto).catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an accepted invite with INVITE_INVALID', async () => {
    database.adminInvite.findUnique.mockResolvedValue(
      invite({ acceptedAt: NOW }),
    );

    const error = await service.accept(dto).catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired invite with INVITE_EXPIRED', async () => {
    database.adminInvite.findUnique.mockResolvedValue(
      invite({ expiresAt: new Date(NOW.getTime() - 1) }),
    );

    const error = await service.accept(dto).catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_EXPIRED');
    expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
  });

  it('409s when the email already has an account, leaving the invite pending', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'user-9' });

    await expect(service.accept(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(database.user.findUnique).toHaveBeenCalledWith({
      where: { email },
    });
    expect(database.adminInvite.updateMany).not.toHaveBeenCalled();
    expect(auth.createFirebaseUser).not.toHaveBeenCalled();
  });

  it('claims the invite before creating anything', async () => {
    database.adminInvite.updateMany.mockResolvedValue({ count: 0 });

    const error = await service.accept(dto).catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(auth.createFirebaseUser).not.toHaveBeenCalled();
  });

  it('rolls back Firebase and the claim when the local user fails', async () => {
    const failure = new Error('db down');
    auth.createLocalUser.mockRejectedValue(failure);

    await expect(service.accept(dto)).rejects.toBe(failure);
    expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('fb-1');
    expect(database.adminInvite.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'invite-1', userId: null },
      data: { acceptedAt: null },
    });
    expect(auth.startSession).not.toHaveBeenCalled();
  });

  it('reverts the claim when Firebase rejects the email', async () => {
    const conflict = new ConflictException('Account already registered');
    auth.createFirebaseUser.mockRejectedValue(conflict);

    await expect(service.accept(dto)).rejects.toBe(conflict);
    expect(database.adminInvite.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'invite-1', userId: null },
      data: { acceptedAt: null },
    });
    expect(auth.createLocalUser).not.toHaveBeenCalled();
  });

  it('rethrows the original error when reverting the claim fails', async () => {
    const conflict = new ConflictException('Account already registered');
    auth.createFirebaseUser.mockRejectedValue(conflict);
    database.adminInvite.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('revert failed'));
    const logged = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(service.accept(dto)).rejects.toBe(conflict);
    expect(logged).toHaveBeenCalled();
  });
});
