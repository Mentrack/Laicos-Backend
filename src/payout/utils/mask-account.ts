export function maskAccount(accountNumber: string): string {
  return `${'*'.repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`;
}
