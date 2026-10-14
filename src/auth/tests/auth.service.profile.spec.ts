import { ConfigService } from '@nestjs/config';
import type { User } from '../../../generated/client';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthService } from '../auth.service';
import { EmailOtpService } from '../email-otp.service';
import { FirebaseService } from '../firebase/firebase.service';

const caller = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Okafor',
  phoneNumber: '+2348012345678',
} as User;

describe('AuthService profile', () => {
  const user = { update: jest.fn() };
  const database = { user };
  const storage = { uploadPublic: jest.fn() };
  const service = new AuthService(
    database as unknown as PrismaService,
    {} as FirebaseService,
    {} as ConfigService,
    {} as MailService,
    {} as EmailOtpService,
    storage as unknown as StorageService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('writes only the fields that were sent', async () => {
    const updated = { ...caller, firstName: 'Aminu' };
    user.update.mockResolvedValue(updated);

    await expect(
      service.updateProfile(caller, { firstName: 'Aminu' }),
    ).resolves.toEqual(updated);

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { firstName: 'Aminu' },
    });
  });

  it('uploads the avatar to the public bucket and persists the URL', async () => {
    const avatarUrl = 'https://cdn.example.com/users/user-1/x.png';
    storage.uploadPublic.mockResolvedValue(avatarUrl);
    user.update.mockResolvedValue({ ...caller, avatarUrl });

    await expect(service.uploadAvatar(caller, imageFile)).resolves.toEqual({
      ...caller,
      avatarUrl,
    });

    expect(storage.uploadPublic).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/user-1\/.+\.png$/),
      imageFile.buffer,
      'image/png',
    );
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { avatarUrl },
    });
  });
});

const imageFile: StorageUploadFile = {
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
  mimetype: 'image/png',
  size: 10,
};
