import { BadRequestException } from '@nestjs/common';
import {
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { BuyerType, Role } from '../../../generated/client';

export const COMPANY_FIELDS = [
  'legalName',
  'department',
  'contactName',
  'contactPhone',
  'paymentTerms',
] as const;

export type CompanyField = (typeof COMPANY_FIELDS)[number];

const LIMITS: Record<CompanyField, number> = {
  legalName: 200,
  department: 120,
  contactName: 120,
  contactPhone: 30,
  paymentTerms: 200,
};

export type BuyerKindFields = Partial<Record<CompanyField, string | null>> & {
  buyerType?: BuyerType | null;
};

/** Null when the fields are a valid buyer or a non-buyer who sent none. */
export function buyerKindError(
  role: string | undefined,
  fields: BuyerKindFields,
): string | null {
  const present = COMPANY_FIELDS.filter((field) => {
    const value = fields[field];
    return value !== undefined && value !== null && value !== '';
  });
  if (role !== Role.BUYER) {
    if (fields.buyerType != null || present.length > 0) {
      return 'Only a buyer has a buyer type';
    }
    return null;
  }
  if (fields.buyerType == null) {
    return 'Buyer type is required';
  }
  if (fields.buyerType === BuyerType.PERSON) {
    if (present.length > 0) {
      return 'A person cannot send company fields';
    }
    return null;
  }
  if (fields.buyerType !== BuyerType.COMPANY) {
    return 'Buyer type is required';
  }
  for (const field of COMPANY_FIELDS) {
    const value = fields[field]?.trim() ?? '';
    if (value.length === 0 || value.length > LIMITS[field]) {
      return 'A company requires a legal name, department, contact name, contact phone, and payment terms';
    }
  }
  return null;
}

export function assertBuyerKind(
  role: string | undefined,
  fields: BuyerKindFields,
): void {
  const message = buyerKindError(role, fields);
  if (message) {
    throw new BadRequestException(message);
  }
}

export function buyerCreateData(fields: BuyerKindFields) {
  if (fields.buyerType === BuyerType.COMPANY) {
    return {
      buyerType: BuyerType.COMPANY,
      legalName: fields.legalName!.trim(),
      department: fields.department!.trim(),
      contactName: fields.contactName!.trim(),
      contactPhone: fields.contactPhone!.trim(),
      paymentTerms: fields.paymentTerms!.trim(),
    };
  }
  return { buyerType: BuyerType.PERSON };
}

@ValidatorConstraint({ name: 'buyerKind', async: false })
export class BuyerKindConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as BuyerKindFields & { role?: string };
    return buyerKindError(dto.role, dto) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as BuyerKindFields & { role?: string };
    return buyerKindError(dto.role, dto) ?? 'Invalid buyer type';
  }
}
