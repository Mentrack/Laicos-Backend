import type { Response } from 'express';
import { type CsvCell, createdAtAfter, csvFile, csvLines } from '../csv';
import { collect } from './collect';

interface Row {
  id: string;
  value: CsvCell;
}

function onePage(rows: Row[]) {
  return () => Promise.resolve(rows);
}

const toCells = (row: Row) => [row.value];

describe('csvLines', () => {
  const cell = async (value: CsvCell) =>
    (await collect(csvLines(['h'], onePage([{ id: '1', value }]), toCells)))
      .split('\r\n')[1];

  it('quotes a cell containing a comma', async () => {
    expect(await cell('a,b')).toBe('"a,b"');
  });

  it('doubles embedded quotes', async () => {
    expect(await cell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes an embedded newline', async () => {
    const text = await collect(
      csvLines(['h'], onePage([{ id: '1', value: 'a\nb' }]), toCells),
    );
    expect(text).toBe('h\r\n"a\nb"\r\n');
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tcmd'])(
    'neutralises a leading formula character in %s',
    async (value) => {
      expect(await cell(value)).toBe(`'${value}`);
    },
  );

  it('writes null as empty and numbers as-is', async () => {
    const text = await collect(
      csvLines(
        ['a', 'b'],
        onePage([{ id: '1', value: null }]),
        (row: Row) => [row.value, 5],
      ),
    );
    expect(text).toBe('a,b\r\n,5\r\n');
  });

  it('writes only the header for no rows', async () => {
    expect(await collect(csvLines(['h'], onePage([]), toCells))).toBe('h\r\n');
  });

  // Rows after `after` by id, standing in for a keyset where clause.
  function pager(ids: string[]) {
    const rows = ids.map((id) => ({ id, value: id }));
    return jest.fn((after: Row | undefined, take: number) =>
      Promise.resolve(
        rows.filter((row) => !after || row.id > after.id).slice(0, take),
      ),
    );
  }

  it('asks for the rows after the last one until a short batch', async () => {
    const fetchPage = pager(['a', 'b', 'c', 'd', 'e']);

    const text = await collect(csvLines(['h'], fetchPage, toCells, 2));

    expect(text).toBe('h\r\na\r\nb\r\nc\r\nd\r\ne\r\n');
    expect(fetchPage.mock.calls).toEqual([
      [undefined, 2],
      [{ id: 'b', value: 'b' }, 2],
      [{ id: 'd', value: 'd' }, 2],
    ]);
  });

  it('stops on an empty batch when the last batch was full', async () => {
    const fetchPage = pager(['a', 'b', 'c', 'd']);

    const text = await collect(csvLines(['h'], fetchPage, toCells, 2));

    expect(text).toBe('h\r\na\r\nb\r\nc\r\nd\r\n');
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('fetches the first batch before writing anything', async () => {
    const lines = csvLines(
      ['h'],
      () => Promise.reject(new Error('database down')),
      toCells,
    );

    await expect(lines.next()).rejects.toThrow('database down');
  });
});

describe('createdAtAfter', () => {
  const row = { createdAt: new Date('2026-10-09T10:00:00.000Z'), id: 'r-2' };

  it('is empty for the first batch', () => {
    expect(createdAtAfter(undefined, 'desc')).toEqual({});
  });

  it('continues below the last row when newest first', () => {
    expect(createdAtAfter(row, 'desc')).toEqual({
      OR: [
        { createdAt: { lt: row.createdAt } },
        { createdAt: row.createdAt, id: { lt: 'r-2' } },
      ],
    });
  });

  it('continues above the last row when oldest first', () => {
    expect(createdAtAfter(row, 'asc')).toEqual({
      OR: [
        { createdAt: { gt: row.createdAt } },
        { createdAt: row.createdAt, id: { gt: 'r-2' } },
      ],
    });
  });
});

describe('csvFile error handler', () => {
  function response(state: { headersSent: boolean; destroyed: boolean }) {
    const res = {
      ...state,
      status: jest.fn(),
      json: jest.fn(),
      destroy: jest.fn(),
      type: jest.fn(),
      removeHeader: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.type.mockReturnValue(res);
    return res;
  }

  async function* nothing(): AsyncGenerator<string> {}

  const handle = (res: ReturnType<typeof response>, err: Error) =>
    csvFile(nothing(), 'x.csv').errorHandler(err, res as unknown as Response);

  it('sets the CSV headers on the file, not on the route', () => {
    expect(csvFile(nothing(), 'farms.csv').getHeaders()).toMatchObject({
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="farms.csv"',
    });
  });

  it('answers a generic 500 as JSON before any bytes are sent', () => {
    const res = response({ headersSent: false, destroyed: false });

    handle(res, new Error('connection refused'));

    expect(res.removeHeader).toHaveBeenCalledWith('Content-Disposition');
    expect(res.type).toHaveBeenCalledWith('application/json');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Something went wrong. Please try again later.',
      error: { code: 'INTERNAL_ERROR', statusCode: 500 },
    });
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('aborts the download once bytes are sent', () => {
    const res = response({ headersSent: true, destroyed: false });
    const err = new Error('connection reset');

    handle(res, err);

    expect(res.destroy).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('does nothing when the response is already gone', () => {
    const res = response({ headersSent: true, destroyed: true });

    handle(res, new Error('late'));

    expect(res.destroy).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
