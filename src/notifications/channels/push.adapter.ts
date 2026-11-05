import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { Agent } from 'undici';
import { isRecord } from '../../common/narrow';
import { PermanentSendError } from '../../common/permanent-send-error';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChannelAdapter,
  ChannelOutcome,
  DeliveryTarget,
} from './channel-adapter';

const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class ExpoPushAdapter implements ChannelAdapter {
  private readonly logger = new Logger(ExpoPushAdapter.name);
  private readonly expo: Expo;

  constructor(
    config: ConfigService,
    private readonly database: PrismaService,
  ) {
    const accessToken = config.get<string>('EXPO_ACCESS_TOKEN')?.trim();
    // The SDK sets no timeout, so a hung Expo request would hold a worker
    // slot for undici's 5-minute default. A timeout throws, which retries.
    const httpAgent = new Agent({
      connectTimeout: REQUEST_TIMEOUT_MS,
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS,
    });
    this.expo = new Expo(
      accessToken ? { accessToken, httpAgent } : { httpAgent },
    );
  }

  async send(target: DeliveryTarget): Promise<ChannelOutcome> {
    const devices = await this.database.pushDevice.findMany({
      where: { userId: target.userId },
      select: { token: true },
    });
    if (devices.length === 0) return 'SKIPPED';

    const messages: ExpoPushMessage[] = devices.map(({ token }) => ({
      to: token,
      title: target.title,
      body: target.body,
      data: isRecord(target.data) ? target.data : {},
      sound: 'default',
    }));

    const deadTokens: string[] = [];
    const rejections: string[] = [];
    let accepted = 0;
    let transient: Error | undefined;

    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      // A failed chunk must not abort the loop: earlier chunks may already
      // have reached devices, and their dead tokens still need pruning.
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        transient ??= error instanceof Error ? error : new Error(String(error));
        continue;
      }
      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          accepted++;
          return;
        }
        const error = ticket.details?.error;
        const token = String(chunk[index].to);
        if (error === 'DeviceNotRegistered') {
          deadTokens.push(token);
          return;
        }
        this.logger.warn(`Expo rejected a push token: ${ticket.message}`);
        if (
          error === 'MessageRateExceeded' ||
          error === 'ExpoError' ||
          error === 'ProviderError'
        ) {
          transient ??= new Error(`Expo push failed: ${ticket.message}`);
          return;
        }
        rejections.push(`${error ?? 'unknown'}: ${ticket.message}`);
      });
    }

    if (deadTokens.length > 0) {
      await this.database.pushDevice.deleteMany({
        where: { token: { in: deadTokens } },
      });
    }

    // One accepted ticket is enough: retrying would re-notify the devices
    // that already received it.
    if (accepted > 0) return 'SENT';
    if (transient) throw transient;
    if (rejections.length === 0) return 'SKIPPED';
    throw new PermanentSendError(
      `Expo rejected every push token: ${rejections.join('; ')}`,
    );
  }
}
