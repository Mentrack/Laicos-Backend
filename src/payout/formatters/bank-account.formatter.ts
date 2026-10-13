import type { FarmerBankAccount } from '../../../generated/client';
import type { BankAccountDto } from '../dto';
import { maskAccount } from '../utils/mask-account';

export function formatBankAccount(account: FarmerBankAccount): BankAccountDto {
  return {
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountNumber: maskAccount(account.accountNumber),
    accountName: account.accountName,
    payoutsHeldUntil: account.payoutsHeldUntil,
    updatedAt: account.updatedAt,
  };
}
