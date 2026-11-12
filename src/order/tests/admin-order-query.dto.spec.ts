import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminOrderQueryDto, AdminOrderTab } from '../dto';

async function invalid(query: object) {
  const errors = await validate(plainToInstance(AdminOrderQueryDto, query));
  return errors.map((error) => error.property);
}

describe('AdminOrderQueryDto', () => {
  it('accepts an empty query and every tab', async () => {
    await expect(invalid({})).resolves.toEqual([]);
    for (const tab of Object.values(AdminOrderTab)) {
      await expect(invalid({ tab })).resolves.toEqual([]);
    }
  });

  it('rejects an unknown tab', async () => {
    await expect(invalid({ tab: 'SHIPPED' })).resolves.toContain('tab');
  });

  it('rejects a malformed date, status or sort', async () => {
    await expect(invalid({ from: '09/10/2026' })).resolves.toContain('from');
    await expect(invalid({ status: 'NOPE' })).resolves.toContain('status');
    await expect(invalid({ sort: 'up' })).resolves.toContain('sort');
  });
});
