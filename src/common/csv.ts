// A leading = + - @ tab or CR makes spreadsheets run the cell as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(
  header: string[],
  rows: (string | number | null)[][],
): string {
  return [header, ...rows]
    .map((row) => row.map(cell).join(',') + '\r\n')
    .join('');
}
