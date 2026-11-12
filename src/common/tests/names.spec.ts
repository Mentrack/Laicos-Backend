import { fullName } from '../names';

describe('fullName', () => {
  it('joins first and last name', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Obi' })).toBe('Ada Obi');
  });

  it('trims when a part is empty', () => {
    expect(fullName({ firstName: 'Ada', lastName: '' })).toBe('Ada');
    expect(fullName({ firstName: '', lastName: 'Obi' })).toBe('Obi');
  });
});
