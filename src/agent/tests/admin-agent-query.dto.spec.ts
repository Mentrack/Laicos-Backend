import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminAgentQueryDto } from '../dto';

describe('AdminAgentQueryDto', () => {
  it('rejects a stateId that is not a UUID', async () => {
    const dto = plainToInstance(AdminAgentQueryDto, { stateId: 'x' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isUuid');
  });

  it('accepts ONBOARDING as a status', async () => {
    const dto = plainToInstance(AdminAgentQueryDto, { status: 'ONBOARDING' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('trims the search', async () => {
    const dto = plainToInstance(AdminAgentQueryDto, { search: '  Halima ' });
    expect(dto.search).toBe('Halima');
    expect(await validate(dto)).toHaveLength(0);
  });
});
