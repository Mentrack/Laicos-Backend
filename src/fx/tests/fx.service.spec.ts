import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FxConfig } from '../fx.config';
import { FxService } from '../fx.service';

const HOUR = 3_600_000;
const now = new Date('2026-10-12T12:00:00Z');

function service(env: Record<string, string> = {}) {
  return new FxService(
    database as unknown as PrismaService,
    new FxConfig(
      new ConfigService({ OPEN_EXCHANGE_RATES_APP_ID: 'app-id', ...env }),
    ),
  );
}

const database = {
  fxRate: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
};
const fetchMock = jest.spyOn(global, 'fetch');

describe('FxService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
  afterAll(() => fetchMock.mockRestore());

  describe('effectiveRate', () => {
    it('returns the newest rate when it is fresh', async () => {
      database.fxRate.findFirst.mockResolvedValue({
        rate: new Prisma.Decimal('1530.123456'),
        fetchedAt: new Date(now.getTime() - HOUR),
      });
      const { rate } = await service().effectiveRate(now);
      expect(rate.toFixed(6)).toBe('1530.123456');
      expect(database.fxRate.findFirst).toHaveBeenCalledWith({
        orderBy: { fetchedAt: 'desc' },
      });
    });

    it('lowers the rate by the margin, so dollars cost more', async () => {
      database.fxRate.findFirst.mockResolvedValue({
        rate: new Prisma.Decimal('1500'),
        fetchedAt: now,
      });
      const { rate } = await service({ FX_MARGIN_PERCENT: '2' }).effectiveRate(
        now,
      );
      expect(rate.toFixed(6)).toBe('1470.000000');
    });

    it.each([
      ['no rate', null],
      [
        'a rate older than FX_MAX_AGE_HOURS',
        {
          rate: new Prisma.Decimal('1500'),
          fetchedAt: new Date(now.getTime() - 6 * HOUR - 1),
        },
      ],
    ])('refuses with %s', async (_label, row) => {
      database.fxRate.findFirst.mockResolvedValue(row);
      const error: unknown = await service()
        .effectiveRate(now)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'FX_RATE_STALE',
      });
    });
  });

  describe('fetchLatest', () => {
    it('stores the NGN rate from Open Exchange Rates', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ base: 'USD', rates: { NGN: 1530.1234567 } }),
        ),
      );
      database.fxRate.create.mockResolvedValue({ id: 'fx-1' });
      await service().fetchLatest();
      const [input] = fetchMock.mock.calls[0];
      expect(input).toBe(
        'https://openexchangerates.org/api/latest.json?app_id=app-id&symbols=NGN',
      );
      const [{ data }] = database.fxRate.create.mock.calls[0] as [
        { data: { rate: Prisma.Decimal; source: string } },
      ];
      expect(data.rate.toFixed(6)).toBe('1530.123457');
      expect(data.source).toBe('openexchangerates');
    });

    it.each([
      ['an error status', new Response('{}', { status: 401 })],
      ['no NGN rate', new Response(JSON.stringify({ rates: {} }))],
      ['a zero rate', new Response(JSON.stringify({ rates: { NGN: 0 } }))],
    ])('throws on %s', async (_label, response) => {
      fetchMock.mockResolvedValueOnce(response);
      await expect(service().fetchLatest()).rejects.toThrow();
      expect(database.fxRate.create).not.toHaveBeenCalled();
    });
  });
});
