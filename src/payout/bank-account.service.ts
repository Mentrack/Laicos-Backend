import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Agent, User } from '../../generated/client';
import { requireFarmer } from '../farm/utils/require-farmer';
import { PaystackClient, type Bank } from '../paystack/paystack.client';
import {
  isDefiniteRejection,
  orProviderUnavailable,
  PaystackError,
  providerUnavailable,
} from '../paystack/paystack-error';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountDto, SetBankAccountDto } from './dto';
import { formatBankAccount } from './formatters/bank-account.formatter';

const DAY_MS = 86_400_000;
// A changed account waits this long before it can be paid.
const CHANGE_HOLD_MS = DAY_MS;

@Injectable()
export class BankAccountService {
  private banks: { list: Bank[]; expiresAt: number } | null = null;

  constructor(
    private readonly database: PrismaService,
    private readonly paystack: PaystackClient,
  ) {}

  async listBanks(): Promise<Bank[]> {
    if (this.banks && this.banks.expiresAt > Date.now()) {
      return this.banks.list;
    }
    const list = await orProviderUnavailable(() => this.paystack.listBanks());
    this.banks = { list, expiresAt: Date.now() + DAY_MS };
    return list;
  }

  async findMine(user: User): Promise<BankAccountDto> {
    const farmer = await requireFarmer(this.database, user);
    const account = await this.database.farmerBankAccount.findUnique({
      where: { farmerId: farmer.id },
    });
    if (!account) {
      throw new NotFoundException({
        message: 'No bank account has been set',
        code: 'BANK_ACCOUNT_NOT_FOUND',
      });
    }
    return formatBankAccount(account);
  }

  async setMine(user: User, dto: SetBankAccountDto): Promise<BankAccountDto> {
    const farmer = await requireFarmer(this.database, user);
    return this.set(farmer.id, user, dto);
  }

  async setForFarmer(
    agent: Agent,
    user: User,
    farmerId: string,
    dto: SetBankAccountDto,
  ): Promise<BankAccountDto> {
    // Same 404 for "not yours" and "doesn't exist", so it leaks neither.
    const farmer = await this.database.farmer.findFirst({
      where: {
        id: farmerId,
        farms: { some: { cluster: { agentId: agent.id } } },
      },
    });
    if (!farmer) {
      throw new NotFoundException({
        message: 'Farmer not found in your cluster',
        code: 'FARMER_NOT_FOUND',
      });
    }
    return this.set(farmer.id, user, dto);
  }

  private async set(farmerId: string, setBy: User, dto: SetBankAccountDto) {
    const bank = (await this.listBanks()).find(
      ({ code }) => code === dto.bankCode,
    );
    if (!bank) {
      throw new BadRequestException({
        message: 'Unknown bank code',
        code: 'UNKNOWN_BANK',
      });
    }
    const accountName = await this.resolve(dto);
    const { recipientCode } = await orProviderUnavailable(() =>
      this.paystack.createTransferRecipient({
        name: accountName,
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
      }),
    );
    const data = {
      bankCode: dto.bankCode,
      bankName: bank.name,
      accountNumber: dto.accountNumber,
      accountName,
      recipientCode,
      setById: setBy.id,
      payoutsHeldUntil: new Date(Date.now() + CHANGE_HOLD_MS),
    };
    const account = await this.database.farmerBankAccount.upsert({
      where: { farmerId },
      create: { farmerId, ...data },
      update: data,
    });
    return formatBankAccount(account);
  }

  private async resolve(dto: SetBankAccountDto): Promise<string> {
    try {
      const { accountName } = await this.paystack.resolveAccount(
        dto.accountNumber,
        dto.bankCode,
      );
      return accountName;
    } catch (error) {
      if (!(error instanceof PaystackError)) {
        throw error;
      }
      // Paystack answers 4xx for an account it can't find; an outage is not
      // "account not found".
      if (isDefiniteRejection(error)) {
        throw new UnprocessableEntityException({
          message: 'We could not find that bank account',
          code: 'BANK_ACCOUNT_UNRESOLVED',
        });
      }
      throw providerUnavailable();
    }
  }
}
