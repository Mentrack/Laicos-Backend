import { BadRequestException } from '@nestjs/common';
import {
  DOCUMENT_SIGNATURES,
  IMAGE_SIGNATURES,
  ParseFileFieldsPipe,
  StorageUploadFile,
  documentUploadPipe,
  imageUploadPipe,
  matchSignature,
} from '../upload-pipes';

function fakeFile(
  overrides: Partial<StorageUploadFile> = {},
): StorageUploadFile {
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
  ])(
    'accepts a %s-signed buffer under the size cap',
    async (_label, header) => {
      const file = fakeFile({ buffer: header, size: header.length });
      await expect(imageUploadPipe().transform(file)).resolves.toBe(file);
    },
  );

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

  it('rejects a request that sent no file at all', async () => {
    await expect(imageUploadPipe().transform(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a file over 5 MB', async () => {
    const oversized = Buffer.concat([
      PNG_HEADER,
      Buffer.alloc(5 * 1024 * 1024),
    ]);
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

  it('accepts a photographed document', async () => {
    const file = fakeFile({ buffer: JPEG_HEADER, size: JPEG_HEADER.length });
    await expect(documentUploadPipe().transform(file)).resolves.toBe(file);
  });

  it('rejects a buffer that is neither PDF nor image', async () => {
    const file = fakeFile({ buffer: Buffer.from('hello'), size: 5 });
    await expect(documentUploadPipe().transform(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ParseFileFieldsPipe', () => {
  const pipe = new ParseFileFieldsPipe(
    { ownership: { required: true }, chief: { required: false } },
    documentUploadPipe,
  );
  const pdf = fakeFile({ buffer: PDF_HEADER, size: PDF_HEADER.length });

  it('returns the first file of each field', async () => {
    await expect(
      pipe.transform({ ownership: [pdf], chief: [pdf] }),
    ).resolves.toEqual({ ownership: pdf, chief: pdf });
  });

  it('skips a missing optional field', async () => {
    await expect(pipe.transform({ ownership: [pdf] })).resolves.toEqual({
      ownership: pdf,
    });
  });

  it('rejects a missing required field', async () => {
    await expect(pipe.transform(undefined)).rejects.toThrow(
      'ownership is required',
    );
  });

  it('validates every file it returns', async () => {
    const bad = fakeFile({ buffer: Buffer.from('hello'), size: 5 });
    await expect(
      pipe.transform({ ownership: [pdf], chief: [bad] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('matchSignature', () => {
  it('returns the matching signature', () => {
    const file = fakeFile({ buffer: PNG_HEADER, size: PNG_HEADER.length });
    expect(matchSignature(IMAGE_SIGNATURES, file).contentType).toBe(
      'image/png',
    );
  });

  it('throws when nothing matches', () => {
    const file = fakeFile({ buffer: Buffer.from('nope'), size: 4 });
    expect(() => matchSignature(DOCUMENT_SIGNATURES, file)).toThrow();
  });
});
