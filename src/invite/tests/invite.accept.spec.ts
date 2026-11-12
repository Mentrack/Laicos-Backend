import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invite, Role, User } from '../../../generated/client';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InviteService } from '../invite.service';
import type { AcceptInviteDto } from '../dto';
import { inviteInvalidError } from '../utils/invite-errors';
import { hashInviteToken } from '../utils/invite-token';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const email = 'new@laicos.test';
const dto: AcceptInviteDto = {
  token: 'raw-token',
  password: 'Password1!',
  firstName: 'Ngozi',
  lastName: 'Adeyemi',
  phoneNumber: '+2348012345678',
};

function invite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: 'invite-1',
    email,
    tokenHash: hashInviteToken(dto.token),
    expiresAt: new Date(NOW.getTime() + 60_000),
    role: Role.ADMIN,
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

describe('InviteService.accept', () => {
  const database = {
    user: { findUnique: jest.fn() },
    invite: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const auth = {
    createFirebaseUser: jest.fn(),
    createLocalUser: jest.fn(),
    createDraftApplication: jest.fn(),
    deleteFirebaseUser: jest.fn(),
    startSession: jest.fn(),
  };
  const service = new InviteService(
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
    database.invite.findUnique.mockResolvedValue(invite());
    database.invite.updateMany.mockResolvedValue({ count: 1 });
    database.invite.update.mockResolvedValue(invite());
    database.$transaction.mockImplementation(
      (run: (tx: typeof database) => Promise<unknown>) => run(database),
    );
    auth.createFirebaseUser.mockResolvedValue({ uid: 'fb-1' });
    auth.createLocalUser.mockResolvedValue(created);
    auth.createDraftApplication.mockResolvedValue(undefined);
    auth.deleteFirebaseUser.mockResolvedValue(undefined);
    auth.startSession.mockResolvedValue(session);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates the admin from the invite and signs them in', async () => {
    const result = await service.accept(dto, Role.ADMIN);

    expect(database.invite.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashInviteToken(dto.token) },
    });
    expect(database.invite.updateMany).toHaveBeenCalledWith({
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
    expect(database.invite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { userId: created.id },
    });
    expect(auth.startSession).toHaveBeenCalledWith(created);
    expect(result).toBe(session);
  });

  it('rejects an unknown token with INVITE_INVALID', async () => {
    database.invite.findUnique.mockResolvedValue(null);

    const error = await service
      .accept(dto, Role.ADMIN)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(database.invite.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an invite of the other role as INVITE_INVALID', async () => {
    database.invite.findUnique.mockResolvedValue(invite({ role: Role.ADMIN }));

    const error = await service
      .accept(dto, Role.EXTENSION_AGENT)
      .catch((e: unknown) => e);
    expect(error).toEqual(inviteInvalidError());
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(database.invite.updateMany).not.toHaveBeenCalled();
  });

  it('as EXTENSION_AGENT creates a verified agent with a draft application', async () => {
    const agent = { id: 'user-3', role: Role.EXTENSION_AGENT } as User;
    database.invite.findUnique.mockResolvedValue(
      invite({ role: Role.EXTENSION_AGENT }),
    );
    auth.createLocalUser.mockResolvedValue(agent);

    await service.accept(dto, Role.EXTENSION_AGENT);

    expect(auth.createFirebaseUser).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );
    const [input, client] = auth.createLocalUser.mock.calls[0] as [
      { role: Role; isVerified: boolean; agreedToTerms?: boolean },
      unknown,
    ];
    expect(input).toMatchObject({
      role: Role.EXTENSION_AGENT,
      isVerified: true,
    });
    expect(input.agreedToTerms).toBe(false);
    expect(client).toBe(database);
    expect(auth.createDraftApplication).toHaveBeenCalledWith(database, agent);
    expect(auth.startSession).toHaveBeenCalledWith(agent);
  });

  it('as ADMIN leaves the application decision to createDraftApplication', async () => {
    await service.accept(dto, Role.ADMIN);

    expect(auth.createDraftApplication).toHaveBeenCalledWith(database, created);
  });

  it('rejects an accepted invite with INVITE_INVALID', async () => {
    database.invite.findUnique.mockResolvedValue(invite({ acceptedAt: NOW }));

    const error = await service
      .accept(dto, Role.ADMIN)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(database.invite.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired invite with INVITE_EXPIRED', async () => {
    database.invite.findUnique.mockResolvedValue(
      invite({ expiresAt: new Date(NOW.getTime() - 1) }),
    );

    const error = await service
      .accept(dto, Role.ADMIN)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_EXPIRED');
    expect(database.invite.updateMany).not.toHaveBeenCalled();
  });

  it('409s when the email already has an account, leaving the invite pending', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'user-9' });

    await expect(service.accept(dto, Role.ADMIN)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(database.user.findUnique).toHaveBeenCalledWith({
      where: { email },
    });
    expect(database.invite.updateMany).not.toHaveBeenCalled();
    expect(auth.createFirebaseUser).not.toHaveBeenCalled();
  });

  it('claims the invite before creating anything', async () => {
    database.invite.updateMany.mockResolvedValue({ count: 0 });

    const error = await service
      .accept(dto, Role.ADMIN)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVITE_INVALID');
    expect(auth.createFirebaseUser).not.toHaveBeenCalled();
  });

  it('rolls back Firebase and the claim when the local user fails', async () => {
    const failure = new Error('db down');
    auth.createLocalUser.mockRejectedValue(failure);

    await expect(service.accept(dto, Role.ADMIN)).rejects.toBe(failure);
    expect(auth.deleteFirebaseUser).toHaveBeenCalledWith('fb-1');
    expect(database.invite.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'invite-1', userId: null },
      data: { acceptedAt: null },
    });
    expect(auth.startSession).not.toHaveBeenCalled();
  });

  it('reverts the claim when Firebase rejects the email', async () => {
    const conflict = new ConflictException('Account already registered');
    auth.createFirebaseUser.mockRejectedValue(conflict);

    await expect(service.accept(dto, Role.ADMIN)).rejects.toBe(conflict);
    expect(database.invite.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'invite-1', userId: null },
      data: { acceptedAt: null },
    });
    expect(auth.createLocalUser).not.toHaveBeenCalled();
  });

  it('rethrows the original error when reverting the claim fails', async () => {
    const conflict = new ConflictException('Account already registered');
    auth.createFirebaseUser.mockRejectedValue(conflict);
    database.invite.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('revert failed'));
    const logged = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(service.accept(dto, Role.ADMIN)).rejects.toBe(conflict);
    expect(logged).toHaveBeenCalled();
  });
});
