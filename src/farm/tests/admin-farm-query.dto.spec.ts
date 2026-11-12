import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FarmVerificationStatus } from '../../../generated/client';
import { AdminFarmFilterDto, AdminFarmQueryDto } from '../dto';

describe('AdminFarmQueryDto', () => {
  it('accepts search, state and status', async () => {
    const dto = plainToInstance(AdminFarmQueryDto, {
      search: 'amina',
      stateId: '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11',
      status: FarmVerificationStatus.PENDING,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('refuses an unknown status', async () => {
    const dto = plainToInstance(AdminFarmQueryDto, { status: 'AWAITING' });
    const [error] = await validate(dto);
    expect(error?.property).toBe('status');
  });

  it('refuses a state id that is not a uuid', async () => {
    const dto = plainToInstance(AdminFarmQueryDto, { stateId: 'oyo' });
    const [error] = await validate(dto);
    expect(error?.property).toBe('stateId');
  });

  it('accepts a known sort', async () => {
    const dto = plainToInstance(AdminFarmQueryDto, { sort: 'FARM_CODE_ASC' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('refuses an unknown sort', async () => {
    const dto = plainToInstance(AdminFarmQueryDto, { sort: 'farmCode' });
    const [error] = await validate(dto);
    expect(error?.property).toBe('sort');
  });

  it('refuses paging on the export filters', async () => {
    const dto = plainToInstance(AdminFarmFilterDto, { page: 2 });
    const [error] = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(error?.property).toBe('page');
  });
});
