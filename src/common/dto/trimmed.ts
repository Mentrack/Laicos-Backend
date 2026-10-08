import { Transform } from 'class-transformer';

// Runs before validation, so `@IsNotEmpty()` also rejects whitespace-only text.
export const Trimmed = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
