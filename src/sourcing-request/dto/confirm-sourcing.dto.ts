import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  isUUID,
  Length,
  MaxLength,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { IsDateOnly } from '../../common/dto/date-only';
import { IsNairaAmount } from '../../common/dto/naira-amount';
import { Trimmed } from '../../common/dto/trimmed';

const NIGERIA = 'Nigeria';

// One spelling for Nigeria, so the stored country compares exactly.
const CountryName = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.toLowerCase() === NIGERIA.toLowerCase() ? NIGERIA : trimmed;
  });

// State and LGA ids only exist for Nigeria, so they are required there and
// refused anywhere else.
const NigeriaOnlyUuid = () =>
  ValidateBy({
    name: 'nigeriaOnlyUuid',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        inNigeria(args) ? isUUID(value) : value === undefined || value === null,
      defaultMessage: (args?: ValidationArguments) =>
        inNigeria(args)
          ? '$property must be a UUID when deliveryCountry is Nigeria'
          : '$property is only allowed when deliveryCountry is Nigeria',
    },
  });

function inNigeria(args?: ValidationArguments): boolean {
  const dto = args?.object;
  return !!dto && 'deliveryCountry' in dto && dto.deliveryCountry === NIGERIA;
}

export class ConfirmSourcingDto {
  @ApiProperty({
    example: '150000.00',
    description:
      'The buyer total, at least the suggested price from the quote (409 SOURCING_PRICE_BELOW_FLOOR)',
  })
  @IsNairaAmount()
  agreedPrice: string;

  @ApiProperty({
    example: 'Nigeria',
    minLength: 2,
    maxLength: 56,
    description: 'Any casing of Nigeria is stored as "Nigeria"',
  })
  @CountryName()
  @IsString()
  @Length(2, 56)
  deliveryCountry: string;

  @ApiProperty({ example: '12 Bompai Road, Kano', maxLength: 300 })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  deliveryAddress: string;

  @ApiPropertyOptional({ example: 'North West', maxLength: 100 })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deliveryRegion?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when deliveryCountry is Nigeria, refused otherwise',
  })
  @NigeriaOnlyUuid()
  deliveryStateId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required when deliveryCountry is Nigeria, refused otherwise; must lie in deliveryStateId',
  })
  @NigeriaOnlyUuid()
  deliveryLgaId?: string;

  @ApiPropertyOptional({ example: 'Musa Ibrahim', maxLength: 100 })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deliveryContactName?: string;

  @ApiPropertyOptional({ example: '+2348012345678', maxLength: 20 })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  deliveryContactPhone?: string;

  @ApiProperty({
    format: 'date',
    example: '2026-11-20',
    description: 'Today or later (Africa/Lagos)',
  })
  @IsDateOnly()
  deliveryFrom: string;

  @ApiProperty({
    format: 'date',
    example: '2026-11-25',
    description: 'On or after deliveryFrom',
  })
  @IsDateOnly()
  deliveryTo: string;
}
