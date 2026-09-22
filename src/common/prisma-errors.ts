import { Prisma } from '../../generated/client';

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return hasPrismaCode(error, 'P2002');
}

/** A delete blocked by a Restrict foreign key. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPrismaCode(error, 'P2003');
}

/** An update, delete or connect whose target row doesn't match the where. */
export function isRecordNotFound(error: unknown): boolean {
  return hasPrismaCode(error, 'P2025');
}
