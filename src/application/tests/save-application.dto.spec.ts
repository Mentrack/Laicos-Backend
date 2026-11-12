import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveApplicationDto } from '../dto/save-application.dto';

async function errorsFor(organisation: unknown) {
  const dto = plainToInstance(SaveApplicationDto, { organisation });
  return validate(dto);
}

describe('SaveApplicationDto organisation', () => {
  it('trims the organisation', async () => {
    const dto = plainToInstance(SaveApplicationDto, {
      organisation: '  Kano State Extension Office ',
    });
    expect(dto.organisation).toBe('Kano State Extension Office');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a blank organisation', async () => {
    expect(await errorsFor('   ')).toHaveLength(1);
  });

  it('rejects an organisation over 120 characters', async () => {
    expect(await errorsFor('a'.repeat(121))).toHaveLength(1);
  });
});
