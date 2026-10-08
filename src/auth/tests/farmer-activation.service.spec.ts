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

describe('FarmerActivationService', () => {
  const user = {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const database = { user };
  const firebase = { auth: { getUser: jest.fn(), updateUser: jest.fn() } };
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
    invites.sendInvite.mockResolvedValue(undefined);
  });
  afterEach(() => error.mockRestore());

  it('activates a farmer once, on a temporary password they must change', async () => {
    await service.activate('user-1');

    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', role: Role.FARMER, activatedAt: null },
      data: {
        activatedAt: expect.any(Date) as unknown,
        mustChangePassword: true,
      },
    });
    const [[uid, { password }]] = firebase.auth.updateUser.mock.calls as [
      [string, { password: string }],
    ];
    expect(uid).toBe('uid-1');
    expect(password).toHaveLength(12);
    expect(invites.sendInvite).toHaveBeenCalledWith(farmer, password);
  });

  it('sets no password for a Google account', async () => {
    firebase.auth.getUser.mockResolvedValue({
      providerData: [{ providerId: 'google.com' }],
    });
    await service.activate('user-1');
    expect(user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          activatedAt: expect.any(Date) as unknown,
          mustChangePassword: false,
        },
      }),
    );
    expect(firebase.auth.updateUser).not.toHaveBeenCalled();
    expect(invites.sendInvite).toHaveBeenCalledWith(farmer, null);
  });

  it('does nothing for a farmer already active', async () => {
    user.updateMany.mockResolvedValue({ count: 0 });
    await service.activate('user-1');
    expect(firebase.auth.updateUser).not.toHaveBeenCalled();
    expect(invites.sendInvite).not.toHaveBeenCalled();
  });

  it('undoes the activation and logs, never throws, when Firebase fails', async () => {
    firebase.auth.updateUser.mockRejectedValue(new Error('firebase down'));
    await expect(service.activate('user-1')).resolves.toBeUndefined();
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { activatedAt: null, mustChangePassword: false },
    });
    expect(invites.sendInvite).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
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
