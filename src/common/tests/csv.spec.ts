import { toCsv } from '../csv';

describe('toCsv', () => {
  const cell = (value: string | number | null) =>
    toCsv(['h'], [[value]]).split('\r\n')[1];

  it('quotes a cell containing a comma', () => {
    expect(cell('a,b')).toBe('"a,b"');
  });

  it('doubles embedded quotes', () => {
    expect(cell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes an embedded newline', () => {
    expect(toCsv(['h'], [['a\nb']])).toBe('h\r\n"a\nb"\r\n');
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tcmd'])(
    'neutralises a leading formula character in %s',
    (value) => {
      expect(cell(value)).toBe(`'${value}`);
    },
  );

  it('writes null as empty and numbers as-is', () => {
    expect(toCsv(['a', 'b'], [[null, 5]])).toBe('a,b\r\n,5\r\n');
  });

  it('joins lines with CRLF and ends with one', () => {
    expect(toCsv(['a'], [['x'], ['y']])).toBe('a\r\nx\r\ny\r\n');
  });
});
