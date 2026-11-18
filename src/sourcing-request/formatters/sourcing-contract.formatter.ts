import type { SourcingContract } from '../../../generated/client';
import type { AgentSourcingContractDto, SourcingContractDto } from '../dto';

export function contractFields(
  contract: SourcingContract,
): AgentSourcingContractDto {
  return {
    id: contract.id,
    agreedPrice: contract.agreedPrice.toFixed(2),
    terms: contract.terms,
    buyerSignedAt: contract.buyerSignedAt,
    agentSignedAt: contract.agentSignedAt,
    voidedAt: contract.voidedAt,
    createdAt: contract.createdAt,
  };
}

export function formatSourcingContract(
  contract: SourcingContract,
  checkoutId: string | null,
): SourcingContractDto {
  return { ...contractFields(contract), checkoutId };
}
