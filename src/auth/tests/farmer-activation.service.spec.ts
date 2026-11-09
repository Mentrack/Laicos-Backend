import { Logger } from '@nestjs/common';
import { Role } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FarmerActivationService } from '../farmer-activation.service';
import { FarmerInviteService } from '../farmer-invite.service';
import { FirebaseService } from '../firebase/firebase.service';

const farmer = {
  id: 'user-1',
  firebaseUid: 'uid-1',
  email: 'ada@example.com',
  role: Role.FARMER,
};

const link = 'https://laicos.firebaseapp.com/__/auth/action?oobCode=abc';

describe('FarmerActivationService', () => {
  const user = {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const database = { user };
  const firebase = {
    auth: { getUser: jest.fn(), updateUser: jest.fn() },
    generatePasswordResetLink: jest.fn(),
  };
  const invites = { sendInvite: jest.fn(), sendRejection: jest.fn() };
  const service = new FarmerActivationService(
    database as unknown as PrismaService,
    firebase as unknown as FirebaseService,
    invites as unknown as FarmerInviteService,
  );
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    user.findUnique.mockResolvedValue(farmer);
    user.updateMany.mockResolvedValue({ count: 1 });
    firebase.auth.getUser.mockResolvedValue({ providerData: [] });
    firebase.auth.updateUser.mockResolvedValue(undefined);
    firebase.generatePasswordResetLink.mockResolvedValue(link);
    invites.sendInvite.mockResolvedValue(undefined);
  });
  afterEach(() => error.mockRestore());

  it('emails a set-password link to a farmer with no sign-in', async () => {
    await service.activate('user-1');

    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', role: Role.FARMER, activatedAt: null },
      data: { activatedAt: expect.any(Date) as unknown },
    });
    expect(firebase.generatePasswordResetLink).toHaveBeenCalledWith(
      'ada@example.com',
    );
    expect(firebase.auth.updateUser).not.toHaveBeenCalled();
    expect(invites.sendInvite).toHaveBeenCalledWith(farmer, link);
  });

  it('keeps the activation when no link can be generated', async () => {
    firebase.generatePasswordResetLink.mockResolvedValue(null);
    await expect(service.activate('user-1')).resolves.toBeUndefined();
    expect(invites.sendInvite).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('a farmer with a password gets the verified email', async () => {
    firebase.auth.getUser.mockResolvedValue({
      providerData: [{ providerId: 'password' }],
    });
    await service.activate('user-1');
    expect(firebase.generatePasswordResetLink).not.toHaveBeenCalled();
    expect(invites.sendInvite).toHaveBeenCalledWith(farmer, null);
  });

  it('a farmer with Google gets the verified email', async () => {
    firebase.auth.getUser.mockResolvedValue({
      providerData: [{ providerId: 'google.com' }],
    });
    await service.activate('user-1');
    expect(user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activatedAt: expect.any(Date) as unknown },
      }),
    );
    expect(firebase.generatePasswordResetLink).not.toHaveBeenCalled();
    expect(invites.sendInvite).toHaveBeenCalledWith(farmer, null);
  });

  it('does nothing for a farmer already active', async () => {
    user.updateMany.mockResolvedValue({ count: 0 });
    await service.activate('user-1');
    expect(invites.sendInvite).not.toHaveBeenCalled();
  });

  it('keeps the activation, and logs, when the invite email fails', async () => {
    invites.sendInvite.mockRejectedValue(new Error('smtp down'));
    await expect(service.activate('user-1')).resolves.toBeUndefined();
    expect(user.update).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('sends a rejection to a farmer not yet active', async () => {
    user.findUnique.mockResolvedValue({ ...farmer, activatedAt: null });
    await service.notifyRejection(
      'user-1',
      'Green Acres',
      'No farm at the address',
    );
    expect(invites.sendRejection).toHaveBeenCalledWith(
      { ...farmer, activatedAt: null },
      'Green Acres',
      'No farm at the address',
    );
  });
});
