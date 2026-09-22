# Supabase Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an S3-compatible `StorageService` against Supabase Storage, shared upload validation with magic-byte sniffing, and a real image-upload endpoint for produce.

**Architecture:** A new `@Global()` `src/storage/` module wraps `@aws-sdk/client-s3` with `forcePathStyle: true`, exposing `uploadPublic`/`uploadPrivate`/`getPresignedUrl`. Shared `ParseFilePipe` factories in `src/common/upload-pipes.ts` validate size and real file content (not the client-supplied mimetype) for any domain that needs uploads. `POST /produce/:id/image` is the first consumer, replacing a produce's `imageUrl`.

**Tech Stack:** NestJS 11, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (already installed), `aws-sdk-client-mock` (new dev dep, for testing), Jest.

**Spec:** [docs/superpowers/specs/2026-09-22-supabase-storage-design.md](../specs/2026-09-22-supabase-storage-design.md)

## Global Constraints

- pnpm only — never npm/yarn.
- `@nestjs/*` stays on v11; `typescript` stays on ~5.7. Don't bump either.
- `module: nodenext`, `target: ES2023`, `strictNullChecks: true`, `noImplicitAny: false` — don't change `tsconfig.json`.
- Controllers are thin: one service call, return the envelope. No logic in controllers.
- Every handler returns `{ data, message, metaData? }` via `ApiEnvelope(Dto)` / `enveloped()` — never hand-roll the envelope shape.
- A required env var is validated at boot via `requireConfig(config, key)` (`src/common/config.ts`) — construction throws if missing/blank, not first use.
- Storage: one S3-API service, `forcePathStyle: true`, two buckets (public → persist URL, private → persist key + presigned URL, default TTL 900s). `onModuleInit` HEADs each bucket and refuses to boot if one is missing, with one escape-hatch env var to skip the check in CI.
- Uploads validated by shared `ParseFilePipe` factories: 5 MB images / 10 MB documents, **magic-byte** content sniffing — never trust the client's `mimetype` field.
- Unit specs go in `src/<module>/tests/*.spec.ts` (Jest `rootDir` is `src`), never next to their source.
- Write lint-clean code: `no-unsafe-*` are errors outside spec files (downgraded to warn in `*.spec.ts`). Never use `eslint-disable` or a cast to silence a rule.
- `pnpm gen:openapi` regenerates `openapi.json`; commit it with any route change.
- No Prisma migration is needed anywhere in this plan — `Produce.imageUrl` already exists as a nullable `String` column.

---

### Task 1: Shared upload validation (`src/common/upload-pipes.ts`)

**Files:**
- Create: `src/common/upload-pipes.ts`
- Test: `src/common/tests/upload-pipes.spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 2's config docs and Task 3):
  - `interface FileSignature { contentType: string; extension: string; matches(buffer: Buffer): boolean }`
  - `interface StorageUploadFile { buffer: Buffer; mimetype: string; size: number }` — the minimal shape validators/storage need; intentionally not `Express.Multer.File` so this module carries no `@types/multer` dependency (Nest's own `FileValidator`/`ParseFilePipe` types are already file-shape-agnostic — see `IFile` in `@nestjs/common`).
  - `const IMAGE_SIGNATURES: FileSignature[]` (PNG, JPEG, WebP)
  - `const DOCUMENT_SIGNATURES: FileSignature[]` (PDF)
  - `function matchSignature(signatures: FileSignature[], file: StorageUploadFile): FileSignature` — throws if nothing matches; only call after a pipe using the same `signatures` already accepted the file.
  - `function imageUploadPipe(): ParseFilePipe` — 5 MB cap, `IMAGE_SIGNATURES`.
  - `function documentUploadPipe(): ParseFilePipe` — 10 MB cap, `DOCUMENT_SIGNATURES`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/common/tests/upload-pipes.spec.ts
import { BadRequestException } from '@nestjs/common';
import {
  DOCUMENT_SIGNATURES,
  IMAGE_SIGNATURES,
  StorageUploadFile,
  documentUploadPipe,
  imageUploadPipe,
  matchSignature,
} from '../upload-pipes';

function fakeFile(overrides: Partial<StorageUploadFile> = {}): StorageUploadFile {
  return {
    mimetype: 'application/octet-stream',
    buffer: Buffer.from([]),
    size: 0,
    ...overrides,
  };
}

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0, 0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
]);
const PDF_HEADER = Buffer.from('%PDF-1.4');

describe('imageUploadPipe', () => {
  it.each([
    ['PNG', PNG_HEADER],
    ['JPEG', JPEG_HEADER],
    ['WebP', WEBP_HEADER],
  ])('accepts a %s-signed buffer under the size cap', async (_label, header) => {
    const file = fakeFile({ buffer: header, size: header.length });
    await expect(imageUploadPipe().transform(file)).resolves.toBe(file);
  });

  it('rejects a buffer whose bytes do not match, even with an image mimetype', async () => {
    const file = fakeFile({
      mimetype: 'image/png',
      buffer: Buffer.from('not actually a png'),
      size: 19,
    });
    await expect(imageUploadPipe().transform(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a file over 5 MB', async () => {
    const oversized = Buffer.concat([PNG_HEADER, Buffer.alloc(5 * 1024 * 1024)]);
    const file = fakeFile({ buffer: oversized, size: oversized.length });
    await expect(imageUploadPipe().transform(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('documentUploadPipe', () => {
  it('accepts a PDF-signed buffer', async () => {
    const file = fakeFile({ buffer: PDF_HEADER, size: PDF_HEADER.length });
    await expect(documentUploadPipe().transform(file)).resolves.toBe(file);
  });

  it('rejects a non-PDF buffer', async () => {
    const file = fakeFile({ buffer: Buffer.from('hello'), size: 5 });
    await expect(documentUploadPipe().transform(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('matchSignature', () => {
  it('returns the matching signature', () => {
    const file = fakeFile({ buffer: PNG_HEADER, size: PNG_HEADER.length });
    expect(matchSignature(IMAGE_SIGNATURES, file).contentType).toBe('image/png');
  });

  it('throws when nothing matches', () => {
    const file = fakeFile({ buffer: Buffer.from('nope'), size: 4 });
    expect(() => matchSignature(DOCUMENT_SIGNATURES, file)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- upload-pipes`
Expected: FAIL — `Cannot find module '../upload-pipes'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/common/upload-pipes.ts
import { FileValidator, MaxFileSizeValidator, ParseFilePipe } from '@nestjs/common';

/**
 * The minimal file shape validators and storage need. Deliberately not
 * `Express.Multer.File` — Nest's own `FileValidator`/`ParseFilePipe` types
 * are already file-shape-agnostic, so this module needs no `@types/multer`.
 */
export interface StorageUploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface FileSignature {
  contentType: string;
  extension: string;
  matches(buffer: Buffer): boolean;
}

function bytesMatchAt(buffer: Buffer, offset: number, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

export const IMAGE_SIGNATURES: FileSignature[] = [
  {
    contentType: 'image/png',
    extension: 'png',
    matches: (buffer) =>
      bytesMatchAt(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    contentType: 'image/jpeg',
    extension: 'jpg',
    matches: (buffer) => bytesMatchAt(buffer, 0, [0xff, 0xd8, 0xff]),
  },
  {
    contentType: 'image/webp',
    extension: 'webp',
    matches: (buffer) =>
      bytesMatchAt(buffer, 0, [0x52, 0x49, 0x46, 0x46]) &&
      bytesMatchAt(buffer, 8, [0x57, 0x45, 0x42, 0x50]),
  },
];

export const DOCUMENT_SIGNATURES: FileSignature[] = [
  {
    contentType: 'application/pdf',
    extension: 'pdf',
    matches: (buffer) => bytesMatchAt(buffer, 0, [0x25, 0x50, 0x44, 0x46]),
  },
];

/**
 * The signature a validated file matched, for building its storage key and
 * content type. Only call this after a `ParseFilePipe` built from the same
 * `signatures` has already accepted the file — it throws otherwise.
 */
export function matchSignature(
  signatures: FileSignature[],
  file: StorageUploadFile,
): FileSignature {
  const match = signatures.find((signature) => signature.matches(file.buffer));
  if (!match) {
    throw new Error('File content does not match an accepted type');
  }
  return match;
}

// Checks real file content, not the client-supplied `mimetype` header, which
// a caller can set to anything regardless of what bytes it actually sends.
class MagicBytesValidator extends FileValidator<
  { signatures: FileSignature[] },
  StorageUploadFile
> {
  isValid(file?: StorageUploadFile): boolean {
    if (!file?.buffer) {
      return false;
    }
    return this.validationOptions.signatures.some((signature) =>
      signature.matches(file.buffer),
    );
  }

  buildErrorMessage(): string {
    const types = this.validationOptions.signatures
      .map((signature) => signature.contentType)
      .join(', ');
    return `File content does not match an accepted type (${types})`;
  }
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** 5 MB max; JPEG/PNG/WebP by content. */
export function imageUploadPipe(): ParseFilePipe {
  return new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: IMAGE_MAX_BYTES }),
      new MagicBytesValidator({ signatures: IMAGE_SIGNATURES }),
    ],
  });
}

/** 10 MB max; PDF by content. */
export function documentUploadPipe(): ParseFilePipe {
  return new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: DOCUMENT_MAX_BYTES }),
      new MagicBytesValidator({ signatures: DOCUMENT_SIGNATURES }),
    ],
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- upload-pipes`
Expected: PASS (10 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/common/upload-pipes.ts src/common/tests/upload-pipes.spec.ts
git commit -m "feat: add shared upload validation with magic-byte sniffing"
```

---

### Task 2: `StorageService` over Supabase's S3-compatible API

**Files:**
- Create: `src/storage/storage.service.ts`
- Create: `src/storage/storage.module.ts`
- Test: `src/storage/tests/storage.service.spec.ts`
- Modify: `src/app.module.ts` — register `StorageModule`
- Modify: `.env.example` — add `S3_*` vars

**Interfaces:**
- Consumes: `requireConfig(config: ConfigService, key: string): string` from `src/common/config.ts` (already exists).
- Produces (used by Task 3):
  - `class StorageService implements OnModuleInit`
  - `uploadPublic(key: string, body: Buffer, contentType: string): Promise<string>` — returns the persisted public URL.
  - `uploadPrivate(key: string, body: Buffer, contentType: string): Promise<string>` — returns the key (not a URL).
  - `getPresignedUrl(key: string, ttlSeconds?: number): Promise<string>` — default `ttlSeconds` is 900.
  - `class StorageModule` — `@Global()`, exports `StorageService`.

- [ ] **Step 1: Add the test dependency**

```bash
pnpm add -D aws-sdk-client-mock
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/storage/tests/storage.service.spec.ts
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
  S3_PUBLIC_URL_BASE: 'https://project-ref.supabase.co/storage/v1/object/public',
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
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
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
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
      Bucket: 'private-bucket',
      Key: 'docs/1/a.pdf',
    });
  });

  describe('getPresignedUrl', () => {
    it('signs a GET against the private bucket with a custom TTL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example.com/x');
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
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example.com/x');
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- storage.service`
Expected: FAIL — `Cannot find module '../storage.service'`.

- [ ] **Step 4: Write the implementation**

```ts
// src/storage/storage.service.ts
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
    this.skipBucketCheck = config.get<string>('S3_SKIP_BUCKET_CHECK') === 'true';

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
```

```ts
// src/storage/storage.module.ts
import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
```

Modify `src/app.module.ts` (full file, `StorageModule` import added and registered, alphabetical with the rest):

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FarmModule } from './farm/farm.module';
import { OrderModule } from './order/order.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProduceModule } from './produce/produce.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    PrismaModule,
    AuthModule,
    FarmModule,
    ProduceModule,
    OrderModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

Append to `.env.example` (after the SMTP block):

```
# Object storage (S3-compatible; Supabase Storage here). All required except
# S3_SKIP_BUCKET_CHECK; the app refuses to boot if a bucket doesn't exist.
S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BUCKET=
S3_PRIVATE_BUCKET=
# Public object read base — a different path than S3_ENDPOINT, so it can't be
# derived from it.
S3_PUBLIC_URL_BASE=https://<project-ref>.supabase.co/storage/v1/object/public
# Skips the boot-time bucket HEAD check. Leave unset except in CI.
# S3_SKIP_BUCKET_CHECK=true
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- storage.service`
Expected: PASS (7 tests).

- [ ] **Step 6: Lint, build and commit**

```bash
pnpm lint
pnpm build
git add src/storage/ src/app.module.ts .env.example package.json pnpm-lock.yaml
git commit -m "feat: add StorageService over Supabase's S3-compatible API"
```

---

### Task 3: Produce image upload endpoint

**Files:**
- Modify: `src/produce/produce.service.ts` — add `attachImage`
- Modify: `src/produce/produce.controller.ts` — add `POST /produce/:id/image`
- Modify: `src/produce/tests/produce.service.spec.ts` — add `attachImage` tests
- Modify: `openapi.json` — regenerated, not hand-edited

**Interfaces:**
- Consumes:
  - `StorageService.uploadPublic(key: string, body: Buffer, contentType: string): Promise<string>` (Task 2)
  - `matchSignature(signatures: FileSignature[], file: StorageUploadFile): FileSignature`, `IMAGE_SIGNATURES`, `imageUploadPipe()`, `StorageUploadFile` (Task 1)
  - `farmOwnedBy(user: Pick<User, 'id'>)` from `src/common/ownership.ts` (existing)
- Produces: `ProduceService.attachImage(user: User, id: string, file: StorageUploadFile): Promise<Produce>`

- [ ] **Step 1: Write the failing tests**

Add to `src/produce/tests/produce.service.spec.ts`. First, extend the existing setup (the `storage` mock and the `service` construction need to change together — replace the current lines building `database`/`service`):

```ts
// Replace the existing `const database = {...}` through
// `const service = new ProduceService(database as unknown as PrismaService);`
// block with:
const database = {
  farm,
  produce,
  // A plain function, not jest.fn, so resetAllMocks keeps it.
  $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
};
const storage = { uploadPublic: jest.fn() };
const service = new ProduceService(
  database as unknown as PrismaService,
  storage as unknown as StorageService,
);
```

Add the new `import { StorageService } from '../../storage/storage.service';` and `import type { StorageUploadFile } from '../../common/upload-pipes';` near the top, alongside the existing imports.

Then add a new top-level `describe` block (after the `remove` test, before the closing brace of the outer `describe('ProduceService', ...)`):

```ts
describe('attachImage', () => {
  const file: StorageUploadFile = {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    mimetype: 'image/png',
    size: 10,
  };

  it('404s on produce the user does not own', async () => {
    produce.findFirst.mockResolvedValue(null);
    await expect(
      service.attachImage(user, produceId, file),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.uploadPublic).not.toHaveBeenCalled();
  });

  it('uploads to the public bucket and persists the returned URL', async () => {
    produce.findFirst.mockResolvedValue({ id: produceId });
    storage.uploadPublic.mockResolvedValue('https://cdn.example.com/produce/x.png');
    produce.update.mockResolvedValue({
      id: produceId,
      imageUrl: 'https://cdn.example.com/produce/x.png',
    });

    await service.attachImage(user, produceId, file);

    expect(storage.uploadPublic).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^produce/${produceId}/.+\\.png$`)),
      file.buffer,
      'image/png',
    );
    expect(produce.update).toHaveBeenCalledWith({
      where: { id: produceId },
      data: { imageUrl: 'https://cdn.example.com/produce/x.png' },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- produce.service`
Expected: FAIL — `service.attachImage is not a function`.

- [ ] **Step 3: Implement `ProduceService.attachImage`**

Modify `src/produce/produce.service.ts`:

```ts
// Add near the top, with the other imports:
import { randomUUID } from 'node:crypto';
import { IMAGE_SIGNATURES, matchSignature } from '../common/upload-pipes';
import type { StorageUploadFile } from '../common/upload-pipes';
import { StorageService } from '../storage/storage.service';

// Change the constructor:
constructor(
  private readonly database: PrismaService,
  private readonly storage: StorageService,
) {}

// Add as a new method, after `create` and before `findAll`:
async attachImage(user: User, id: string, file: StorageUploadFile) {
  const current = await this.database.produce.findFirst({
    where: { id, farm: farmOwnedBy(user) },
    select: { id: true },
  });
  if (!current) {
    throw new NotFoundException('Produce not found');
  }
  const { contentType, extension } = matchSignature(IMAGE_SIGNATURES, file);
  const imageUrl = await this.storage.uploadPublic(
    `produce/${id}/${randomUUID()}.${extension}`,
    file.buffer,
    contentType,
  );
  return this.database.produce.update({
    where: { id },
    data: { imageUrl },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- produce.service`
Expected: PASS (all existing tests plus the 2 new `attachImage` tests).

- [ ] **Step 5: Add the controller route**

Modify `src/produce/produce.controller.ts`:

```ts
// Update the @nestjs/common import to add UploadedFile and UseInterceptors:
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { imageUploadPipe, type StorageUploadFile } from '../common/upload-pipes';

// Add as a new route, after `create`:
@Post(':id/image')
@Auth(Role.FARMER)
@UseInterceptors(FileInterceptor('file'))
@ApiConsumes('multipart/form-data')
@ApiBody({
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
})
@ApiEnvelope(ProduceDto)
async attachImage(
  @CurrentUser() user: User,
  @Param('id', ParseUUIDPipe) id: string,
  @UploadedFile(imageUploadPipe()) file: StorageUploadFile,
) {
  const data = await this.produce.attachImage(user, id, file);
  return { data, message: 'Produce image updated' };
}
```

- [ ] **Step 6: Regenerate the OpenAPI doc, lint, build and commit**

```bash
pnpm lint
pnpm gen:openapi
pnpm build
git add src/produce/ openapi.json
git commit -m "feat: add produce image upload endpoint"
```

---

## Final verification

- [ ] Run the full suite: `pnpm test` — all specs pass.
- [ ] Run `pnpm build` — compiles clean.
- [ ] Manually verify boot: with real (or Supabase-project) `S3_*` values in `.env`, run `pnpm start:dev` and confirm the app boots without a bucket error; then confirm it refuses to boot when `S3_PUBLIC_BUCKET` is pointed at a bucket that doesn't exist.
- [ ] Manually verify the upload flow through `/v1/docs`: create a produce as a FARMER, call `POST /produce/:id/image` with a real image file, confirm the response's `imageUrl` is a reachable Supabase object URL, and confirm `GET /produce/:id` reflects it.
