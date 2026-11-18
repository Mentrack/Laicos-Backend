import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProduceStatus } from '../../../generated/client';
import { AdminProduceQueryDto, ProduceQueryDto } from '../dto';

describe.each([
  ['ProduceQueryDto', ProduceQueryDto],
  ['AdminProduceQueryDto', AdminProduceQueryDto],
])('%s status filter', (_name, Dto) => {
  it('rejects SOURCED, which is never listed', async () => {
    const dto = plainToInstance(Dto, { status: ProduceStatus.SOURCED });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain('status');
  });

  it('still accepts PUBLISHED', async () => {
    const dto = plainToInstance(Dto, { status: ProduceStatus.PUBLISHED });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
