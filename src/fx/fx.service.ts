import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type FxRate } from '../../generated/client';
import { isRecord } from '../common/narrow';
import { PrismaService } from '../prisma/prisma.service';
import { FxRateDto } from './dto/fx-rate.dto';
import { FxConfig } from './fx.config';

const HOUR_MS = 3_600_000;
const SOURCE = 'openexchangerates';

@Injectable()
export class FxService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: FxConfig,
  ) {}

  async effectiveRate(now: Date = new Date()) {
    const latest = await this.database.fxRate.findFirst({
      orderBy: { fetchedAt: 'desc' },
    });
    if (
      !latest ||
      now.getTime() - latest.fetchedAt.getTime() >
        this.config.maxAgeHours * HOUR_MS
    ) {
      throw new ConflictException({
        message:
          'Dollar payments are unavailable right now; please pay in naira or try again later',
        code: 'FX_RATE_STALE',
      });
    }
    // A lower NGN-per-USD rate means the buyer pays more dollars.
    const rate = latest.rate
      .mul(new Prisma.Decimal(100).sub(this.config.marginPercent))
      .div(100)
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);
    return { rate, fetchedAt: latest.fetchedAt };
  }

  async currentRate(): Promise<FxRateDto> {
    const { rate, fetchedAt } = await this.effectiveRate();
    return { rate: rate.toFixed(6), fetchedAt };
  }

  async hasRate(): Promise<boolean> {
    return (await this.database.fxRate.count()) > 0;
  }

  async fetchLatest(): Promise<FxRate> {
    const query = new URLSearchParams({
      app_id: this.config.appId,
      symbols: 'NGN',
    });
    const response = await fetch(
      `https://openexchangerates.org/api/latest.json?${query.toString()}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) {
      throw new Error(`Open Exchange Rates responded ${response.status}`);
    }
    const body: unknown = await response.json();
    return this.database.fxRate.create({
      data: { rate: ngnPerUsd(body), source: SOURCE },
    });
  }
}

function ngnPerUsd(body: unknown): Prisma.Decimal {
  const rates = isRecord(body) ? body.rates : undefined;
  const ngn = isRecord(rates) ? rates.NGN : undefined;
  if (typeof ngn !== 'number' || !(ngn > 0)) {
    throw new Error('Open Exchange Rates returned no NGN rate');
  }
  return new Prisma.Decimal(ngn).toDecimalPlaces(6);
}
