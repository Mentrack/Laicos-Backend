import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IdType, Role } from '../../../generated/client';
import { CompleteApplicationDto } from '../dto/complete-application.dto';

function messages(dto: CompleteApplicationDto): Promise<string[]> {
  return validate(dto).then((errors) =>
    errors.flatMap((error) => Object.values(error.constraints ?? {})),
  );
}

describe('CompleteApplicationDto', () => {
  it('lists every gap when a farmer submits an empty application', async () => {
    const dto = plainToInstance(CompleteApplicationDto, { role: Role.FARMER });
    expect(await messages(dto)).toEqual([
      'Phone number is required',
      'You must agree to the terms',
      'ID type is required',
      'ID number is required',
      'ID document is required',
      'State is required',
      'LGA is required',
      'Farm name is required',
      'Address is required',
      'Size is required',
      'Main produce is required',
      'Ownership document is required',
    ]);
  });

  it('accepts a farmer application that has every required field', async () => {
    const dto = plainToInstance(CompleteApplicationDto, {
      role: Role.FARMER,
      phoneNumber: '+2348012345678',
      agreedToTerms: true,
      idType: IdType.NIN,
      idNumber: '123',
      idDocumentKey: 'id',
      stateId: 'state-1',
      lgaId: 'lga-1',
      farmName: 'Green Acres',
      location: '12 Market Road',
      size: 2,
      mainProduce: 'Maize',
      ownershipDocumentKey: 'own',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('does not require farm fields from an extension agent', async () => {
    const dto = plainToInstance(CompleteApplicationDto, {
      role: Role.EXTENSION_AGENT,
      phoneNumber: '+2348012345678',
      agreedToTerms: true,
      idType: IdType.NIN,
      idNumber: '123',
      idDocumentKey: 'id',
      stateId: 'state-1',
      lgaId: 'lga-1',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
