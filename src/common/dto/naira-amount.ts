import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

/** A naira amount sent as a string: above 0, at most 2 decimals. */
export const IsNairaAmount = () =>
  applyDecorators(
    IsString(),
    // Decimal(12, 2) holds 10 whole digits; the lookahead rejects zero.
    Matches(/^(?!0+(\.0+)?$)\d{1,10}(\.\d{1,2})?$/, {
      message: '$property must be an amount above 0 with at most 2 decimals',
    }),
  );
