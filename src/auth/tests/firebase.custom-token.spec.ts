import { ConfigService } from '@nestjs/config';
import { getAuth } from 'firebase-admin/auth';
import { FirebaseService } from '../firebase/firebase.service';

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(),
  getApps: () => [],
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

describe('FirebaseService.signInWithCustomToken', () => {
  const createCustomToken = jest.fn().mockResolvedValue('custom-token');
  jest
    .mocked(getAuth)
    .mockReturnValue({ createCustomToken } as unknown as ReturnType<
      typeof getAuth
    >);
  const service = new FirebaseService(
    new ConfigService({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'sa@example.com',
      FIREBASE_PRIVATE_KEY: 'key',
      FIREBASE_API_KEY: 'api-key',
    }),
  );

  afterEach(() => jest.restoreAllMocks());

  it('exchanges a custom token for a session for the uid', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          idToken: 'id',
          refreshToken: 'refresh',
          expiresIn: '3600',
        }),
        { status: 200 },
      ),
    );

    await expect(service.signInWithCustomToken('uid-1')).resolves.toEqual({
      idToken: 'id',
      refreshToken: 'refresh',
      localId: 'uid-1',
      expiresIn: '3600',
    });
    expect(createCustomToken).toHaveBeenCalledWith('uid-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/accounts:signInWithCustomToken?key=api-key');
    expect(init?.body).toBe(
      JSON.stringify({ token: 'custom-token', returnSecureToken: true }),
    );
  });

  it('fails loudly when Google returns no session', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(service.signInWithCustomToken('uid-1')).rejects.toThrow(
      'Custom token sign-in returned no session',
    );
  });
});
