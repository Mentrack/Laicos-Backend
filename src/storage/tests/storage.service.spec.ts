import { ConfigService } from '@nestjs/config';
import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mockClient } from 'aws-sdk-client-mock';
import { StorageService } from '../storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const ENV: Record<string, string> = {
  S3_ENDPOINT: 'https://project-ref.supabase.co/storage/v1/s3',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_BUCKET: 'public-bucket',
  S3_PRIVATE_BUCKET: 'private-bucket',
  S3_PUBLIC_URL_BASE:
    'https://project-ref.supabase.co/storage/v1/object/public',
};

function fakeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values = { ...ENV, ...overrides };
  return {
    getOrThrow: (key: string) => values[key],
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('HEADs both buckets', async () => {
      s3Mock.on(HeadBucketCommand).resolves({});
      const service = new StorageService(fakeConfig());
      await service.onModuleInit();
      expect(
        s3Mock.commandCalls(HeadBucketCommand, { Bucket: 'public-bucket' }),
      ).toHaveLength(1);
      expect(
        s3Mock.commandCalls(HeadBucketCommand, { Bucket: 'private-bucket' }),
      ).toHaveLength(1);
    });

    it('refuses to boot when a bucket HEAD fails', async () => {
      s3Mock.on(HeadBucketCommand).rejects(new Error('not found'));
      const service = new StorageService(fakeConfig());
      await expect(service.onModuleInit()).rejects.toThrow('not found');
    });

    it('skips the HEAD check when S3_SKIP_BUCKET_CHECK is set', async () => {
      const service = new StorageService(
        fakeConfig({ S3_SKIP_BUCKET_CHECK: 'true' }),
      );
      await service.onModuleInit();
      expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(0);
    });
  });

  it('uploadPublic puts the object and returns the public URL', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const service = new StorageService(fakeConfig());
    const url = await service.uploadPublic(
      'produce/1/a.png',
      Buffer.from('x'),
      'image/png',
    );
    expect(url).toBe(
      'https://project-ref.supabase.co/storage/v1/object/public/public-bucket/produce/1/a.png',
    );
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: 'public-bucket',
      Key: 'produce/1/a.png',
      ContentType: 'image/png',
    });
  });

  it('uploadPrivate puts the object and returns the key, not a URL', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const service = new StorageService(fakeConfig());
    const key = await service.uploadPrivate(
      'docs/1/a.pdf',
      Buffer.from('x'),
      'application/pdf',
    );
    expect(key).toBe('docs/1/a.pdf');
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: 'private-bucket',
      Key: 'docs/1/a.pdf',
    });
  });

  describe('getPresignedUrl', () => {
    it('signs a GET against the private bucket with a custom TTL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://signed.example.com/x',
      );
      const service = new StorageService(fakeConfig());
      const url = await service.getPresignedUrl('docs/1/a.pdf', 60);
      expect(url).toBe('https://signed.example.com/x');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.any(S3Client),
        expect.any(Object),
        { expiresIn: 60 },
      );
    });

    it('defaults to a 900s TTL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://signed.example.com/x',
      );
      const service = new StorageService(fakeConfig());
      await service.getPresignedUrl('docs/1/a.pdf');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.any(S3Client),
        expect.any(Object),
        { expiresIn: 900 },
      );
    });
  });
});
