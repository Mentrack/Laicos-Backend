import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Currency } from '../../../generated/client';
import { PaystackClient } from '../paystack.client';
import { PaystackConfig } from '../paystack.config';
import { PaystackError } from '../paystack-error';

const SECRET = 'sk_test_secret';
const client = new PaystackClient(
  new PaystackConfig(
    new ConfigService({
      PAYSTACK_SECRET_KEY: SECRET,
      PAYSTACK_CALLBACK_URL: 'https://app.laicos.test/payments/callback',
    }),
  ),
);
const fetchMock = jest.spyOn(global, 'fetch');

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

function sent(call = 0) {
  const [input, init] = fetchMock.mock.calls[call];
  const url = input instanceof Request ? input.url : input.toString();
  const body: unknown =
    typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  return { url, method: init?.method, headers: init?.headers, body };
}

async function failure(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(PaystackError);
  return error as PaystackError;
}

describe('PaystackClient', () => {
  beforeEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it('initializes a transaction with the secret key', async () => {
    reply({
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: 'https://checkout.paystack.com/abc',
        access_code: 'abc',
        reference: 'PAY-000001',
      },
    });
    await expect(
      client.initializeTransaction({
        email: 'buyer@example.com',
        amount: 3758,
        currency: Currency.USD,
        reference: 'PAY-000001',
        callbackUrl: 'https://app.laicos.test/payments/callback',
        channels: ['card'],
        metadata: { checkoutId: 'c-1', paymentId: 'p-1' },
      }),
    ).resolves.toEqual({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
    });
    expect(sent()).toEqual({
      url: 'https://api.paystack.co/transaction/initialize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET}`,
        'Content-Type': 'application/json',
      },
      body: {
        email: 'buyer@example.com',
        amount: 3758,
        currency: 'USD',
        reference: 'PAY-000001',
        callback_url: 'https://app.laicos.test/payments/callback',
        channels: ['card'],
        metadata: { checkoutId: 'c-1', paymentId: 'p-1' },
      },
    });
  });

  it("raises Paystack's own message on an error response", async () => {
    reply({ status: false, message: 'Invalid key' }, 401);
    const error = await failure(client.verifyTransaction('PAY-000001'));
    expect(error.message).toBe('Invalid key');
    expect(error.httpStatus).toBe(401);
  });

  it('treats status false as a failure even on a 200', async () => {
    reply({ status: false, message: 'Duplicate reference' });
    await expect(failure(client.verifyTransaction('x'))).resolves.toMatchObject(
      { message: 'Duplicate reference' },
    );
  });

  it('reports an unreachable API without a status', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const error = await failure(client.verifyTransaction('x'));
    expect(error.httpStatus).toBeNull();
  });

  it('rejects a response missing a field it needs', async () => {
    reply({ status: true, data: { reference: 'PAY-000001' } });
    await expect(
      failure(client.verifyTransaction('PAY-000001')),
    ).resolves.toBeInstanceOf(PaystackError);
  });

  it('narrows a verified transaction', async () => {
    reply({
      status: true,
      data: {
        reference: 'PAY-000001',
        status: 'success',
        amount: 5_750_000,
        currency: 'NGN',
        channel: 'bank_transfer',
      },
    });
    await expect(client.verifyTransaction('PAY-000001')).resolves.toEqual({
      reference: 'PAY-000001',
      status: 'success',
      amount: 5_750_000,
      currency: 'NGN',
      channel: 'bank_transfer',
    });
    expect(sent().url).toBe(
      'https://api.paystack.co/transaction/verify/PAY-000001',
    );
  });

  it('creates a refund and returns its id as a string', async () => {
    reply({ status: true, data: { id: 3018284, status: 'pending' } });
    await expect(
      client.createRefund({ reference: 'PAY-000001', amount: 450_000 }),
    ).resolves.toEqual({ id: '3018284' });
    expect(sent().body).toEqual({ transaction: 'PAY-000001', amount: 450_000 });
  });

  it('follows the cursor through every page of banks', async () => {
    reply({
      status: true,
      data: [{ name: 'Access Bank', code: '044' }],
      meta: { next: 'cursor-2' },
    });
    reply({
      status: true,
      data: [{ name: 'GTBank', code: '058' }],
      meta: { next: null },
    });
    await expect(client.listBanks()).resolves.toEqual([
      { name: 'Access Bank', code: '044' },
      { name: 'GTBank', code: '058' },
    ]);
    expect(sent(1).url).toBe(
      'https://api.paystack.co/bank?currency=NGN&perPage=100&use_cursor=true&next=cursor-2',
    );
  });

  it('resolves an account number to its name', async () => {
    reply({ status: true, data: { account_name: 'ADA OKAFOR' } });
    await expect(client.resolveAccount('0123456789', '058')).resolves.toEqual({
      accountName: 'ADA OKAFOR',
    });
    expect(sent().url).toBe(
      'https://api.paystack.co/bank/resolve?account_number=0123456789&bank_code=058',
    );
  });

  it('creates an NGN transfer recipient', async () => {
    reply({ status: true, data: { recipient_code: 'RCP_abc' } });
    await expect(
      client.createTransferRecipient({
        name: 'ADA OKAFOR',
        accountNumber: '0123456789',
        bankCode: '058',
      }),
    ).resolves.toEqual({ recipientCode: 'RCP_abc' });
    expect(sent().body).toEqual({
      type: 'nuban',
      name: 'ADA OKAFOR',
      account_number: '0123456789',
      bank_code: '058',
      currency: 'NGN',
    });
  });

  it('queues a bulk transfer from the balance', async () => {
    reply({
      status: true,
      data: [{ reference: 'po-1', transfer_code: 'TRF_1', status: 'pending' }],
    });
    await expect(
      client.bulkTransfer([
        {
          amount: 900_000,
          recipient: 'RCP_abc',
          reference: 'po-1',
          reason: 'r',
        },
      ]),
    ).resolves.toEqual([{ reference: 'po-1', transferCode: 'TRF_1' }]);
    expect(sent().body).toEqual({
      currency: 'NGN',
      source: 'balance',
      transfers: [
        {
          amount: 900_000,
          recipient: 'RCP_abc',
          reference: 'po-1',
          reason: 'r',
        },
      ],
    });
  });

  describe('verifySignature', () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac('sha512', SECRET).update(body).digest('hex');

    it('accepts the HMAC-SHA512 of the raw body', () => {
      expect(client.verifySignature(body, signature)).toBe(true);
    });

    it.each([
      ['missing', undefined],
      ['wrong', 'a'.repeat(128)],
      ['short', 'abc'],
    ])('rejects a %s signature', (_label, given) => {
      expect(client.verifySignature(body, given)).toBe(false);
    });
  });
});
