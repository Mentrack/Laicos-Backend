import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

// Matches pins the date-only shape; strict ISO 8601 rejects 2026-02-30.
export const IsDateOnly = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: '$property must be YYYY-MM-DD',
    }),
    IsISO8601({ strict: true }),
  );
