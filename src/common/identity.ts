import type { IdType } from '../../generated/client';
import type { StorageService } from '../storage/storage.service';
import type { IdentityDto } from './dto/identity.dto';
import { DOCUMENT_SIGNATURES, type StorageUploadFile } from './upload-pipes';

interface IdentityRow {
  idType: IdType | null;
  idNumber: string | null;
  idDocumentKey: string | null;
}

/** The stored key never leaves the server; only a short-lived URL does. */
export async function formatIdentity(
  storage: StorageService,
  row: IdentityRow,
): Promise<IdentityDto> {
  return {
    idType: row.idType,
    idNumber: row.idNumber,
    idDocumentUrl: await storage.presignedUrlOrNull(row.idDocumentKey),
  };
}

/**
 * Uploads a replacement ID document, stores its key through `save`, then
 * removes the previous object. A failed save removes the new upload instead,
 * so neither path leaves an unreferenced file.
 */
export async function replaceIdDocument(
  storage: StorageService,
  prefix: string,
  file: StorageUploadFile,
  previousKey: string | null,
  save: (key: string) => Promise<unknown>,
): Promise<void> {
  const key = await storage.uploadPrivateFile(
    prefix,
    file,
    DOCUMENT_SIGNATURES,
  );
  try {
    await save(key);
  } catch (error) {
    await storage.deletePrivate([key]);
    throw error;
  }
  await storage.deletePrivate([previousKey]);
}
