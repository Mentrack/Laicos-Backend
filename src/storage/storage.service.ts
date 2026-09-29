import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireConfig } from '../common/config';
import {
  matchSignature,
  type FileSignature,
  type StorageUploadFile,
} from '../common/upload-pipes';

const DEFAULT_PRESIGN_TTL_SECONDS = 900;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
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

  /**
   * Stores an already-validated upload at `<prefix>/<uuid>.<ext>` in the
   * private bucket and returns its key. `signatures` must be the ones the
   * route's pipe validated against.
   */
  uploadPrivateFile(
    prefix: string,
    file: StorageUploadFile,
    signatures: FileSignature[],
  ): Promise<string> {
    const { contentType, extension } = matchSignature(signatures, file);
    return this.uploadPrivate(
      `${prefix}/${randomUUID()}.${extension}`,
      file.buffer,
      contentType,
    );
  }

  /**
   * Best-effort cleanup of private objects nothing references any more. A
   * failed delete only orphans an object, so it logs instead of failing the
   * request that already committed.
   */
  async deletePrivate(keys: (string | null | undefined)[]): Promise<void> {
    await Promise.all(
      keys
        .filter((key): key is string => Boolean(key))
        .map((key) =>
          this.client
            .send(
              new DeleteObjectCommand({ Bucket: this.privateBucket, Key: key }),
            )
            .catch((error: unknown) => {
              this.logger.warn(`Failed to delete private object ${key}`, error);
            }),
        ),
    );
  }

  presignedUrlOrNull(key: string | null): Promise<string | null> {
    return key ? this.getPresignedUrl(key) : Promise.resolve(null);
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
