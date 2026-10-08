import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProduceDto } from '../dto';

// A multipart body arrives with every field as a string, so the DTO has to
// coerce its own numbers: the global ValidationPipe transforms but does not
// convert implicitly.
const multipartBody = {
  farmId: '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11',
  name: 'Maize',
  actualQuantity: '500',
  unit: 'kg',
  pricePerUnit: '350.50',
};

// Mirrors the global pipe in main.ts, which is what strips unknown fields.
const pipeOptions = { whitelist: true, forbidNonWhitelisted: true };

describe('CreateProduceDto', () => {
  it('coerces the multipart number fields', async () => {
    const dto = plainToInstance(CreateProduceDto, multipartBody);

    expect(dto.actualQuantity).toBe(500);
    expect(dto.pricePerUnit).toBe(350.5);
    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
  });

  it('still rejects a quantity that is not a number', async () => {
    const dto = plainToInstance(CreateProduceDto, {
      ...multipartBody,
      actualQuantity: 'lots',
    });

    const errors = await validate(dto, pipeOptions);

    expect(errors.map((error) => error.property)).toContain('actualQuantity');
  });

  it('rejects a client-supplied imageUrl: the photo comes from the upload', async () => {
    const dto = plainToInstance(CreateProduceDto, {
      ...multipartBody,
      imageUrl: 'https://example.com/not-ours.png',
    });

    const errors = await validate(dto, pipeOptions);

    expect(errors.map((error) => error.property)).toContain('imageUrl');
  });

  it('accepts an optional category', async () => {
    const dto = plainToInstance(CreateProduceDto, {
      ...multipartBody,
      category: 'GRAINS',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
  });

  it('rejects an unknown category', async () => {
    const dto = plainToInstance(CreateProduceDto, {
      ...multipartBody,
      category: 'CARS',
    });

    const errors = await validate(dto, pipeOptions);

    expect(errors.map((error) => error.property)).toContain('category');
  });

  it('accepts an optional description and specs', async () => {
    const dto = plainToInstance(CreateProduceDto, {
      ...multipartBody,
      description: 'Freshly harvested premium cassava tubers.',
      specs: 'Grade A — Fresh Harvest',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
  });

  it('caps description at 1000 characters and specs at 120', async () => {
    const dto = plainToInstance(CreateProduceDto, {
      ...multipartBody,
      description: 'x'.repeat(1001),
      specs: 'x'.repeat(121),
    });

    const errors = await validate(dto, pipeOptions);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['description', 'specs']),
    );
  });
});
