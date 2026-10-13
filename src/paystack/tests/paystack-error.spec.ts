import { isDefiniteRejection, PaystackError } from '../paystack-error';

describe('isDefiniteRejection', () => {
  it.each([400, 422])('treats %s as a definite rejection', (status) => {
    expect(isDefiniteRejection(new PaystackError('no', status))).toBe(true);
  });

  it.each([null, 200, 408, 502])(
    'treats %s as an unknown outcome',
    (status) => {
      expect(isDefiniteRejection(new PaystackError('?', status))).toBe(false);
    },
  );
});
