import { plainToInstance } from 'class-transformer';
import {
  Equals,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  validate,
  ValidateIf,
  type ValidationError,
} from 'class-validator';
import { IdType, Role, type Application } from '../../../generated/client';

const forFarmer = (dto: CompleteApplicationDto) => dto.role === Role.FARMER;

/**
 * Validated against the stored draft after this request is written.
 * The HTTP body stays partial: fields and files saved earlier still count,
 * and the file keys are not part of the request body.
 */
export class CompleteApplicationDto {
  static fromApplication(
    role: Role,
    application: Application,
  ): CompleteApplicationDto {
    return plainToInstance(CompleteApplicationDto, {
      role,
      phoneNumber: application.phoneNumber,
      agreedToTerms: application.agreedToTerms,
      idType: application.idType,
      idNumber: application.idNumber,
      idDocumentKey: application.idDocumentKey,
      stateId: application.stateId,
      lgaId: application.lgaId,
      farmName: application.farmName,
      location: application.location,
      size: application.size,
      mainProduce: application.mainProduce,
      ownershipDocumentKey: application.ownershipDocumentKey,
    });
  }

  async messages(): Promise<string[]> {
    const errors = await validate(this);
    return errors.flatMap((error) => constraintMessages(error));
  }

  role: Role;

  @IsNotEmpty({ message: 'Phone number is required' })
  phoneNumber: string;

  @Equals(true, { message: 'You must agree to the terms' })
  agreedToTerms: boolean;

  @IsEnum(IdType, { message: 'ID type is required' })
  idType: IdType;

  @IsNotEmpty({ message: 'ID number is required' })
  idNumber: string;

  @IsNotEmpty({ message: 'ID document is required' })
  idDocumentKey: string;

  @IsNotEmpty({ message: 'State is required' })
  stateId: string;

  @IsNotEmpty({ message: 'LGA is required' })
  lgaId: string;

  @ValidateIf(forFarmer)
  @IsNotEmpty({ message: 'Farm name is required' })
  farmName: string;

  @ValidateIf(forFarmer)
  @IsNotEmpty({ message: 'Address is required' })
  location: string;

  @ValidateIf(forFarmer)
  @IsDefined({ message: 'Size is required' })
  size: number;

  @ValidateIf(forFarmer)
  @IsNotEmpty({ message: 'Main produce is required' })
  mainProduce: string;

  @ValidateIf(forFarmer)
  @IsNotEmpty({ message: 'Ownership document is required' })
  ownershipDocumentKey: string;
}

function constraintMessages(error: ValidationError): string[] {
  return Object.values(error.constraints ?? {});
}
