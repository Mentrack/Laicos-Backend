export function farmDocumentsSummary(
  ownershipKey: string | null | undefined,
  chiefKey: string | null | undefined,
): string | null {
  const hasOwnership = Boolean(ownershipKey);
  const hasChief = Boolean(chiefKey);
  if (!hasOwnership && !hasChief) {
    return null;
  }
  if (hasOwnership && hasChief) {
    return 'ownership and chief confirmation';
  }
  if (hasOwnership) {
    return 'ownership';
  }
  return 'chief confirmation';
}

export function verificationDocumentsSummary(
  farmCode: string,
  documents: {
    idDocument?: unknown;
    ownershipDocument?: unknown;
    chiefConfirmation?: unknown;
  },
): string {
  const parts: string[] = [];
  if (documents.idDocument) {
    parts.push('ID');
  }
  if (documents.ownershipDocument) {
    parts.push('ownership');
  }
  if (documents.chiefConfirmation) {
    parts.push('chief confirmation');
  }
  return `${farmCode}: ${parts.join(', ')}`;
}
