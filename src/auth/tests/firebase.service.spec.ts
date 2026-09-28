import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(),
  getApps: () => [],
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

function respond(status: number, body: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('FirebaseService.signInWithGoogle', () => {
  const service = new FirebaseService(
    new ConfigService({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'sa@example.com',
      FIREBASE_PRIVATE_KEY: 'key',
      FIREBASE_API_KEY: 'api-key',
    }),
  );

  afterEach(() => jest.restoreAllMocks());

  it('exchanges the Google ID token and returns the profile', async () => {
    const profile = {
      idToken: 'id',
      refreshToken: 'refresh',
      localId: 'uid',
      expiresIn: '3600',
      email: 'ada@example.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Okafor',
      isNewUser: true,
    };
    const fetchMock = respond(200, profile);

    await expect(service.signInWithGoogle('google-token')).resolves.toEqual(
      profile,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/accounts:signInWithIdp?key=api-key');
    if (typeof init?.body !== 'string') {
      throw new Error('Expected a JSON string body');
    }
    const body = JSON.parse(init.body) as { postBody: string };
    expect(new URLSearchParams(body.postBody).get('id_token')).toBe(
      'google-token',
    );
  });

  it('falls back to the display name when Google gives no first name', async () => {
    respond(200, {
      idToken: 'id',
      refreshToken: 'refresh',
      localId: 'uid',
      email: 'ada@example.com',
      displayName: 'Ada',
    });

    await expect(
      service.signInWithGoogle('google-token'),
    ).resolves.toMatchObject({
      firstName: 'Ada',
      lastName: '',
      emailVerified: false,
      isNewUser: false,
    });
  });

  it('maps a rejected Google token, detail suffix included, to a 401', async () => {
    respond(400, {
      error: { message: 'INVALID_IDP_RESPONSE : audience mismatch' },
    });

    await expect(service.signInWithGoogle('bad')).rejects.toThrow(
      new UnauthorizedException('Invalid Google credential'),
    );
  });
});
