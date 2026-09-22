import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireConfig } from '../common/config';

const DEFAULT_PRESIGN_TTL_SECONDS = 900;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicUrlBase: string;
  private readonly skipBucketCheck: boolean;

  constructor(config: ConfigService) {
    const endpoint = requireConfig(config, 'S3_ENDPOINT');
    const region = requireConfig(config, 'S3_REGION');
    const accessKeyId = requireConfig(config, 'S3_ACCESS_KEY_ID');
    const secretAccessKey = requireConfig(config, 'S3_SECRET_ACCESS_KEY');
    this.publicBucket = requireConfig(config, 'S3_PUBLIC_BUCKET');
    this.privateBucket = requireConfig(config, 'S3_PRIVATE_BUCKET');
    // Different base path than S3_ENDPOINT (object reads vs. the S3 API), so
    // it isn't derived from it.
    this.publicUrlBase = requireConfig(config, 'S3_PUBLIC_URL_BASE').replace(
      /\/$/,
      '',
    );
    this.skipBucketCheck =
      config.get<string>('S3_SKIP_BUCKET_CHECK') === 'true';

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  // The provider answers a PUT into a missing bucket with a silent 200, so a
  // missing bucket must fail loud at boot instead.
  async onModuleInit(): Promise<void> {
    if (this.skipBucketCheck) {
      return;
    }
    await Promise.all([
      this.client.send(new HeadBucketCommand({ Bucket: this.publicBucket })),
      this.client.send(new HeadBucketCommand({ Bucket: this.privateBucket })),
    ]);
  }

  async uploadPublic(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.publicBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${this.publicUrlBase}/${this.publicBucket}/${key}`;
  }

  async uploadPrivate(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  }

  getPresignedUrl(
    key: string,
    ttlSeconds: number = DEFAULT_PRESIGN_TTL_SECONDS,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.privateBucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }
}
