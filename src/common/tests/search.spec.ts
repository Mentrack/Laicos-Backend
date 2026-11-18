import { searchTokens } from '../search';

describe('searchTokens', () => {
  it('splits on any run of whitespace and drops the ends', () => {
    expect(searchTokens('  Ada \t Okafor\n')).toEqual(['Ada', 'Okafor']);
  });

  it('is empty for a missing or blank search', () => {
    expect(searchTokens(undefined)).toEqual([]);
    expect(searchTokens('   ')).toEqual([]);
  });
});
