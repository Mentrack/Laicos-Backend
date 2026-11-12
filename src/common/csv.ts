import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { errorBody } from './filters/http-exception.filter';

export type CsvCell = string | number | null;

export const EXPORT_BATCH_SIZE = 1000;

type Direction = 'asc' | 'desc';

/**
 * Keyset filter for rows after `last` in [createdAt, id] order. Spread
 * alongside the export's own filter with AND; empty for the first batch.
 */
export function createdAtAfter(
  last: { createdAt: Date; id: string } | undefined,
  direction: Direction,
) {
  if (!last) return {};
  return {
    OR: [
      { createdAt: beyond(direction, last.createdAt) },
      { createdAt: last.createdAt, id: beyond(direction, last.id) },
    ],
  };
}

/** The filter for values past `value` in the given sort direction. */
export function beyond<V>(direction: Direction, value: V) {
  return direction === 'desc' ? { lt: value } : { gt: value };
}

// A leading = + - @ tab or CR makes spreadsheets run the cell as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: CsvCell): string {
  if (value === null) return '';
  const text = String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function line(cells: CsvCell[]): string {
  return cells.map(cell).join(',') + '\r\n';
}

/**
 * The header, then one chunk per batch, so memory holds a few batches
 * whatever the table size. `fetchPage` returns the `take` rows after `after`
 * by comparing sort values (keyset), not by Prisma's cursor: a cursor row
 * deleted or filtered out mid-export would end the file early or drop the
 * next row. Batches are separate reads, so the file is not a point-in-time
 * snapshot. The first batch is read before the header so a failing database
 * still gets a JSON error instead of a started download.
 */
export async function* csvLines<T>(
  header: string[],
  fetchPage: (after: T | undefined, take: number) => Promise<T[]>,
  toCells: (row: T) => CsvCell[],
  batchSize = EXPORT_BATCH_SIZE,
): AsyncGenerator<string> {
  let rows = await fetchPage(undefined, batchSize);
  yield line(header);
  for (;;) {
    if (rows.length > 0) {
      yield rows.map((row) => line(toCells(row))).join('');
    }
    if (rows.length < batchSize) return;
    rows = await fetchPage(rows[rows.length - 1], batchSize);
  }
}

/**
 * The CSV headers ride on the file, not a route @Header, which would also
 * label a 400 from validation as text/csv. The handler replaces Nest's, which
 * echoes err.message as a 400 and ends a cut-off download as if complete.
 */
export function csvFile(
  lines: AsyncIterable<string>,
  filename: string,
): StreamableFile {
  return new StreamableFile(Readable.from(lines), {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${filename}"`,
  }).setErrorHandler((err: Error, res: Response) => {
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    const body = errorBody(err);
    res.removeHeader('Content-Disposition');
    res.type('application/json').status(body.error.statusCode).json(body);
  });
}
