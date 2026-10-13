import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Currency } from '../../generated/client';
import { isRecord } from '../common/narrow';
import { identifier, integer, optionalText, record, text } from './narrow';
import { PaystackConfig } from './paystack.config';
import { PaystackError } from './paystack-error';

const BASE_URL = 'https://api.paystack.co';
const TIMEOUT_MS = 15_000;
// Guards the bank-list cursor loop against a server that never ends it.
const MAX_BANK_PAGES = 20;

export type InitializeTransaction = {
  email: string;
  amount: number;
  currency: Currency;
  reference: string;
  callbackUrl: string;
  channels?: string[];
  metadata: Record<string, string>;
};

export type VerifiedTransaction = {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  channel: string | null;
};

export type Bank = { name: string; code: string };

export type TransferOrder = {
  amount: number;
  recipient: string;
  reference: string;
  reason: string;
};

export type QueuedTransfer = { reference: string; transferCode: string };

/** Every Paystack call goes through here; responses are narrowed on arrival. */
@Injectable()
export class PaystackClient {
  constructor(private readonly config: PaystackConfig) {}

  async initializeTransaction(input: InitializeTransaction) {
    const data = record(
      (
        await this.request('POST', '/transaction/initialize', {
          email: input.email,
          amount: input.amount,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          channels: input.channels,
          metadata: input.metadata,
        })
      ).data,
      'data',
    );
    return {
      authorizationUrl: text(data, 'authorization_url'),
      accessCode: text(data, 'access_code'),
    };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const data = record(
      (
        await this.request(
          'GET',
          `/transaction/verify/${encodeURIComponent(reference)}`,
        )
      ).data,
      'data',
    );
    return {
      reference: text(data, 'reference'),
      status: text(data, 'status'),
      amount: integer(data, 'amount'),
      currency: text(data, 'currency'),
      channel: optionalText(data, 'channel'),
    };
  }

  async createRefund(input: { reference: string; amount: number }) {
    const data = record(
      (
        await this.request('POST', '/refund', {
          transaction: input.reference,
          amount: input.amount,
        })
      ).data,
      'data',
    );
    return { id: identifier(data, 'id') };
  }

  async listBanks(): Promise<Bank[]> {
    const banks: Bank[] = [];
    let next: string | null = null;
    for (let page = 0; page < MAX_BANK_PAGES; page++) {
      const cursor = next ? `&next=${encodeURIComponent(next)}` : '';
      const envelope = await this.request(
        'GET',
        `/bank?currency=NGN&perPage=100&use_cursor=true${cursor}`,
      );
      if (!Array.isArray(envelope.data)) {
        throw new PaystackError('Malformed Paystack response: data', null);
      }
      for (const item of envelope.data) {
        const bank = record(item, 'bank');
        banks.push({ name: text(bank, 'name'), code: text(bank, 'code') });
      }
      next = isRecord(envelope.meta)
        ? optionalText(envelope.meta, 'next')
        : null;
      if (!next) {
        return banks;
      }
    }
    return banks;
  }

  async resolveAccount(accountNumber: string, bankCode: string) {
    const query = new URLSearchParams({
      account_number: accountNumber,
      bank_code: bankCode,
    });
    const data = record(
      (await this.request('GET', `/bank/resolve?${query.toString()}`)).data,
      'data',
    );
    return { accountName: text(data, 'account_name') };
  }

  async createTransferRecipient(input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }) {
    const data = record(
      (
        await this.request('POST', '/transferrecipient', {
          type: 'nuban',
          name: input.name,
          account_number: input.accountNumber,
          bank_code: input.bankCode,
          currency: 'NGN',
        })
      ).data,
      'data',
    );
    return { recipientCode: text(data, 'recipient_code') };
  }

  async bulkTransfer(transfers: TransferOrder[]): Promise<QueuedTransfer[]> {
    const { data } = await this.request('POST', '/transfer/bulk', {
      currency: 'NGN',
      source: 'balance',
      transfers,
    });
    if (!Array.isArray(data)) {
      throw new PaystackError('Malformed Paystack response: data', null);
    }
    return data.map((item) => {
      const transfer = record(item, 'transfer');
      return {
        reference: text(transfer, 'reference'),
        transferCode: text(transfer, 'transfer_code'),
      };
    });
  }

  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) {
      return false;
    }
    const expected = Buffer.from(
      createHmac('sha512', this.config.secretKey).update(rawBody).digest('hex'),
    );
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaystackError(
        `Paystack unreachable: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    const envelope = isRecord(payload) ? payload : {};
    if (!response.ok || envelope.status !== true) {
      throw new PaystackError(
        typeof envelope.message === 'string'
          ? envelope.message
          : `Paystack responded ${response.status}`,
        response.status,
      );
    }
    return envelope;
  }
}
