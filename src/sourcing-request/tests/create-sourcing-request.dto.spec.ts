import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSourcingRequestDto } from '../dto';

const body = {
  produceName: 'Sesame Seeds (Bulk)',
  quantity: 20,
  unit: 'TONNES',
  quality: 'GRADE_A',
  packaging: 'BAGS',
  condition: 'FRESH',
  additionalSpecs: 'Moisture below 8%',
  deliveryDestination: 'Warehouse A, Ibadan, Oyo State',
  requiredDate: '2026-11-15',
  timeline: 'WITHIN_2_WEEKS',
  logisticsNotes: 'Dock 3',
};

// Mirrors the global pipe in main.ts.
const pipeOptions = { whitelist: true, forbidNonWhitelisted: true };

async function invalidProperties(overrides: Record<string, unknown>) {
  const dto = plainToInstance(CreateSourcingRequestDto, {
    ...body,
    ...overrides,
  });
  const errors = await validate(dto, pipeOptions);
  return errors.map((error) => error.property);
}

describe('CreateSourcingRequestDto', () => {
  it('accepts a complete request', async () => {
    await expect(invalidProperties({})).resolves.toEqual([]);
  });

  it('accepts a request without the optional notes', async () => {
    await expect(
      invalidProperties({
        additionalSpecs: undefined,
        logisticsNotes: undefined,
      }),
    ).resolves.toEqual([]);
  });

  it('trims the free-text fields', () => {
    const dto = plainToInstance(CreateSourcingRequestDto, {
      ...body,
      produceName: '  Sesame  ',
      deliveryDestination: ' Ibadan ',
      additionalSpecs: ' dry ',
      logisticsNotes: ' dock ',
    });

    expect(dto).toMatchObject({
      produceName: 'Sesame',
      deliveryDestination: 'Ibadan',
      additionalSpecs: 'dry',
      logisticsNotes: 'dock',
    });
  });

  it('rejects a produce name that is blank once trimmed', async () => {
    await expect(invalidProperties({ produceName: '   ' })).resolves.toContain(
      'produceName',
    );
  });

  it('rejects a produce name over 100 characters', async () => {
    await expect(
      invalidProperties({ produceName: 'a'.repeat(101) }),
    ).resolves.toContain('produceName');
  });

  it('rejects a blank destination', async () => {
    await expect(
      invalidProperties({ deliveryDestination: ' ' }),
    ).resolves.toContain('deliveryDestination');
  });

  it('rejects a destination over 200 characters', async () => {
    await expect(
      invalidProperties({ deliveryDestination: 'a'.repeat(201) }),
    ).resolves.toContain('deliveryDestination');
  });

  it('rejects notes over 1000 characters', async () => {
    await expect(
      invalidProperties({
        additionalSpecs: 'a'.repeat(1001),
        logisticsNotes: 'a'.repeat(1001),
      }),
    ).resolves.toEqual(
      expect.arrayContaining(['additionalSpecs', 'logisticsNotes']),
    );
  });

  it.each([0, -5, Number.POSITIVE_INFINITY, '20'])(
    'rejects quantity %p',
    async (quantity) => {
      await expect(invalidProperties({ quantity })).resolves.toContain(
        'quantity',
      );
    },
  );

  it.each(['unit', 'quality', 'packaging', 'condition', 'timeline'])(
    'rejects an unknown %s',
    async (field) => {
      await expect(invalidProperties({ [field]: 'NOPE' })).resolves.toContain(
        field,
      );
    },
  );

  it.each(['2026-11-15T10:00:00Z', '15/11/2026', '2026-02-30', 'soon'])(
    'rejects requiredDate %p: it must be a calendar date',
    async (requiredDate) => {
      await expect(invalidProperties({ requiredDate })).resolves.toContain(
        'requiredDate',
      );
    },
  );
});
