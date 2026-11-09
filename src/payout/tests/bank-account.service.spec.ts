import { HttpException } from '@nestjs/common';
import { Prisma, Role, type Agent, type User } from '../../../generated/client';
import type { PaystackClient } from '../../paystack/paystack.client';
import { PaystackError } from '../../paystack/paystack-error';
import { PrismaService } from '../../prisma/prisma.service';
import { BankAccountService } from '../bank-account.service';

const farmerUser = { id: 'user-farmer', role: Role.FARMER } as User;
const agentUser = { id: 'user-agent', role: Role.EXTENSION_AGENT } as User;
const agent = { id: 'agent-1' } as Agent;
const dto = { bankCode: '058', accountNumber: '0123456789' };
const DAY = 86_400_000;

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('BankAccountService', () => {
  const database = {
    farmer: { findUnique: jest.fn(), findFirst: jest.fn() },
    bankAccount: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
    },
  };
  const paystack = {
    listBanks: jest.fn(),
    resolveAccount: jest.fn(),
    createTransferRecipient: jest.fn(),
  };
  let service: BankAccountService;

  beforeEach(() => {
    jest.resetAllMocks();
    // Fresh per test: the bank list is cached on the instance.
    service = new BankAccountService(
      database as unknown as PrismaService,
      paystack as unknown as PaystackClient,
    );
    database.farmer.findUnique.mockResolvedValue({
      id: 'farmer-1',
      userId: 'farmer-user-1',
    });
    database.farmer.findFirst.mockResolvedValue({
      id: 'farmer-1',
      userId: 'farmer-user-1',
    });
    paystack.listBanks.mockResolvedValue([{ name: 'GTBank', code: '058' }]);
    paystack.resolveAccount.mockResolvedValue({ accountName: 'ADA OKAFOR' });
    paystack.createTransferRecipient.mockResolvedValue({
      recipientCode: 'RCP_abc',
    });
    database.bankAccount.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ ...create, updatedAt: new Date() }),
    );
    database.bankAccount.findUnique.mockResolvedValue(null);
    database.bankAccount.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, updatedAt: new Date() }),
    );
  });

  it('caches the bank list', async () => {
    await service.listBanks();
    await service.listBanks();
    expect(paystack.listBanks).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the bank list is unavailable', async () => {
    paystack.listBanks.mockRejectedValue(new PaystackError('down', null));
    await expect(errorBody(service.listBanks())).resolves.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
  });

  it("saves a farmer's resolved account and holds payouts for 24h", async () => {
    const before = Date.now();
    await expect(service.setMine(farmerUser, dto)).resolves.toMatchObject({
      bankName: 'GTBank',
      accountNumber: '******6789',
      accountName: 'ADA OKAFOR',
    });
    expect(paystack.resolveAccount).toHaveBeenCalledWith('0123456789', '058');
    expect(paystack.createTransferRecipient).toHaveBeenCalledWith({
      name: 'ADA OKAFOR',
      accountNumber: '0123456789',
      bankCode: '058',
    });
    const [{ where, create, update }] = database.bankAccount.upsert.mock
      .calls[0] as [
      {
        where: unknown;
        create: { payoutsHeldUntil: Date; setById: string };
        update: unknown;
      },
    ];
    expect(where).toEqual({ userId: farmerUser.id });
    expect(create.setById).toBe(farmerUser.id);
    expect(create.payoutsHeldUntil.getTime()).toBeGreaterThanOrEqual(
      before + DAY,
    );
    expect(update).toEqual(
      expect.objectContaining({
        recipientCode: 'RCP_abc',
        setById: farmerUser.id,
      }),
    );
  });

  it('lets an agent set the account of a farmer in their cluster', async () => {
    await service.setForFarmer(agent, agentUser, 'farmer-1', dto);
    expect(database.bankAccount.create).toHaveBeenCalledTimes(1);
    expect(database.farmer.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'farmer-1',
        farms: { some: { cluster: { agentId: 'agent-1' } } },
      },
    });
  });

  it('404s a farmer outside the agent’s cluster', async () => {
    database.farmer.findFirst.mockResolvedValue(null);
    await expect(
      errorBody(service.setForFarmer(agent, agentUser, 'farmer-9', dto)),
    ).resolves.toMatchObject({ code: 'FARMER_NOT_FOUND' });
    expect(paystack.resolveAccount).not.toHaveBeenCalled();
  });

  it('refuses a bank Paystack does not list', async () => {
    await expect(
      errorBody(service.setMine(farmerUser, { ...dto, bankCode: '999' })),
    ).resolves.toMatchObject({ code: 'UNKNOWN_BANK' });
  });

  it('answers 422 for an account Paystack cannot resolve', async () => {
    paystack.resolveAccount.mockRejectedValue(
      new PaystackError('Could not resolve account name', 422),
    );
    await expect(
      errorBody(service.setMine(farmerUser, dto)),
    ).resolves.toMatchObject({ code: 'BANK_ACCOUNT_UNRESOLVED' });
    expect(database.bankAccount.upsert).not.toHaveBeenCalled();
  });

  it('answers 409 when Paystack is down while resolving', async () => {
    paystack.resolveAccount.mockRejectedValue(new PaystackError('down', null));
    await expect(
      errorBody(service.setMine(farmerUser, dto)),
    ).resolves.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  });

  it('answers 409 when Paystack times out while resolving', async () => {
    paystack.resolveAccount.mockRejectedValue(
      new PaystackError('Request timeout', 408),
    );
    await expect(
      errorBody(service.setMine(farmerUser, dto)),
    ).resolves.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  });

  it('does not read a malformed 200 response as an unresolved account', async () => {
    paystack.resolveAccount.mockRejectedValue(
      new PaystackError('Unexpected response', 200),
    );
    await expect(
      errorBody(service.setMine(farmerUser, dto)),
    ).resolves.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  });

  it('404s a farmer with no account yet', async () => {
    database.bankAccount.findUnique.mockResolvedValue(null);
    await expect(
      errorBody(service.findMine(farmerUser)),
    ).resolves.toMatchObject({ code: 'BANK_ACCOUNT_NOT_FOUND' });
  });

  it('creates the account an agent sets for a farmer, held for 24h', async () => {
    const before = Date.now();
    await service.setForFarmer(agent, agentUser, 'farmer-1', dto);
    const [{ data }] = database.bankAccount.create.mock.calls[0] as [
      { data: { userId: string; setById: string; payoutsHeldUntil: Date } },
    ];
    expect(data.userId).toBe('farmer-user-1');
    expect(data.setById).toBe(agentUser.id);
    expect(data.payoutsHeldUntil.getTime()).toBeGreaterThanOrEqual(
      before + DAY,
    );
    expect(database.bankAccount.upsert).not.toHaveBeenCalled();
  });

  it('locks a farmer account that already exists against the agent', async () => {
    database.bankAccount.findUnique.mockResolvedValue({ id: 'acct-1' });
    await expect(
      errorBody(service.setForFarmer(agent, agentUser, 'farmer-1', dto)),
    ).resolves.toMatchObject({ code: 'BANK_ACCOUNT_LOCKED' });
    expect(paystack.resolveAccount).not.toHaveBeenCalled();
    expect(database.bankAccount.create).not.toHaveBeenCalled();
  });

  it('maps losing a concurrent create to BANK_ACCOUNT_LOCKED', async () => {
    database.bankAccount.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      errorBody(service.setForFarmer(agent, agentUser, 'farmer-1', dto)),
    ).resolves.toMatchObject({ code: 'BANK_ACCOUNT_LOCKED' });
  });

  it("upserts an agent's own account on their user id", async () => {
    await service.setMine(agentUser, dto);
    const [{ where, create }] = database.bankAccount.upsert.mock.calls[0] as [
      { where: unknown; create: { userId: string } },
    ];
    expect(where).toEqual({ userId: agentUser.id });
    expect(create.userId).toBe(agentUser.id);
  });

  it('404s an agent with no account yet', async () => {
    await expect(errorBody(service.findMine(agentUser))).resolves.toMatchObject(
      { code: 'BANK_ACCOUNT_NOT_FOUND' },
    );
    expect(database.bankAccount.findUnique).toHaveBeenCalledWith({
      where: { userId: agentUser.id },
    });
  });
});
