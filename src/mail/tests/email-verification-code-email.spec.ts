import { emailVerificationCodeEmail } from '../templates';

describe('emailVerificationCodeEmail', () => {
  const email = emailVerificationCodeEmail({
    firstName: '<Ada>',
    code: '0042',
    expiresInMinutes: 10,
  });

  it('puts the code in the subject, html and text', () => {
    expect(email.subject).toContain('0042');
    expect(email.html).toContain('0042');
    expect(email.text).toContain('0042');
  });

  it('states the lifetime', () => {
    expect(email.text).toContain('10 minutes');
  });

  it('escapes the name in html', () => {
    expect(email.html).toContain('&lt;Ada&gt;');
    expect(email.html).not.toContain('<Ada>');
  });
});
