import { Transform } from 'class-transformer';

// Firebase lowercases emails but local lookups are exact: without this, an
// account registered as Ada@Example.com can't be found as ada@example.com.
export const NormalizedEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
