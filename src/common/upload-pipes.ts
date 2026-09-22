import {
  FileValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
} from '@nestjs/common';

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

function bytesMatchAt(
  buffer: Buffer,
  offset: number,
  bytes: number[],
): boolean {
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

// Exported so `FileInterceptor`'s own `limits.fileSize` can reject an
// oversized upload before multer buffers it into memory, instead of only
// after — `ParseFilePipe`'s `MaxFileSizeValidator` below still runs as
// defence in depth on whatever gets through.
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
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
