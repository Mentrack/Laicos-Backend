import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RejectAgentDto } from '../dto';

describe('RejectAgentDto', () => {
  it('trims the reason', async () => {
    const dto = plainToInstance(RejectAgentDto, { reason: '  Blurry ID ' });
    expect(dto.reason).toBe('Blurry ID');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a 200-character reason', async () => {
    const dto = plainToInstance(RejectAgentDto, { reason: 'a'.repeat(200) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([[undefined], ['   '], ['a'.repeat(201)]])(
    'rejects %p',
    async (reason) => {
      const dto = plainToInstance(RejectAgentDto, { reason });
      expect(await validate(dto)).toHaveLength(1);
    },
  );
});
