import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuspendAgentDto } from '../dto';

describe('SuspendAgentDto', () => {
  it('trims the reason and accepts 200 characters without an end', async () => {
    const dto = plainToInstance(SuspendAgentDto, {
      reason: ` ${'a'.repeat(200)} `,
    });
    expect(dto.reason).toHaveLength(200);
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([[undefined], ['   '], ['a'.repeat(201)]])(
    'rejects reason %p',
    async (reason) => {
      const dto = plainToInstance(SuspendAgentDto, { reason });
      expect(await validate(dto)).toHaveLength(1);
    },
  );

  it('transforms an ISO until into a Date', async () => {
    const dto = plainToInstance(SuspendAgentDto, {
      reason: 'Repeated no-shows',
      until: '2026-12-01T00:00:00.000Z',
    });
    expect(dto.until).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an until that is not a date', async () => {
    const dto = plainToInstance(SuspendAgentDto, {
      reason: 'Repeated no-shows',
      until: 'not-a-date',
    });
    expect(await validate(dto)).toHaveLength(1);
  });
});
