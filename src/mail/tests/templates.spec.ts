import {
  adminInviteEmail,
  farmRejectedEmail,
  farmerInviteEmail,
  farmerVerifiedGoogleEmail,
  informationRequestEmail,
  passwordResetEmail,
} from '../templates';

const loginUrl = 'https://app.laicos.ng/login';

describe('email templates', () => {
  it('invites a farmer with their temporary password and the login link', () => {
    const email = farmerInviteEmail({
      firstName: 'Ada',
      email: 'ada@example.com',
      temporaryPassword: 'Tmp-Pass_123',
      loginUrl,
    });
    expect(email.subject).toBe('Your farm is verified – welcome to LAICOS');
    for (const body of [email.html, email.text]) {
      expect(body).toContain('Ada');
      expect(body).toContain('ada@example.com');
      expect(body).toContain('Tmp-Pass_123');
      expect(body).toContain(loginUrl);
      expect(body).toMatch(/change (it|your password)/i);
    }
  });

  it('invites an admin with their temporary password and the login link', () => {
    const email = adminInviteEmail({
      firstName: 'Laicos',
      email: 'admin@laicos.test',
      temporaryPassword: 'Tmp-Pass_123',
      loginUrl,
    });
    expect(email.subject).toMatch(/admin/i);
    for (const body of [email.html, email.text]) {
      expect(body).toContain('Laicos');
      expect(body).toContain('admin@laicos.test');
      expect(body).toContain('Tmp-Pass_123');
      expect(body).toContain(loginUrl);
      expect(body).toMatch(/change your password/i);
    }
  });

  it('tells a Google farmer to sign in with Google, with no password', () => {
    const email = farmerVerifiedGoogleEmail({ firstName: 'Ada', loginUrl });
    expect(email.text).toContain('Google');
    expect(email.text).not.toMatch(/temporary password/i);
    expect(email.html).toContain(loginUrl);
  });

  it('gives the rejection reason', () => {
    const email = farmRejectedEmail({
      firstName: 'Ada',
      farmName: 'Green Acres',
      reason: 'No farm at the address',
    });
    expect(email.subject).toContain('Green Acres');
    expect(email.text).toContain('No farm at the address');
    expect(email.html).toContain('No farm at the address');
  });

  it('links to the reset page', () => {
    const resetUrl = 'https://app.laicos.ng/reset-password?oobCode=abc';
    const email = passwordResetEmail({ firstName: 'Ada', resetUrl });
    expect(email.subject).toBe('Reset your LAICOS password');
    expect(email.html).toContain(
      'href="https://app.laicos.ng/reset-password?oobCode=abc"',
    );
    expect(email.text).toContain(resetUrl);
  });

  it('asks an agent for the documents an admin named', () => {
    const email = informationRequestEmail({
      firstName: 'Halima',
      farmCode: 'LF-000451',
      documents: ['Location document', 'Signed declaration'],
      note: 'Upload both before the next review.',
    });
    expect(email.subject).toContain('LF-000451');
    for (const body of [email.html, email.text]) {
      expect(body).toContain('Halima');
      expect(body).toContain('LF-000451');
      expect(body).toContain('Location document');
      expect(body).toContain('Signed declaration');
      expect(body).toContain('Upload both before the next review.');
    }
  });

  it('escapes what users typed into the HTML', () => {
    const email = farmRejectedEmail({
      firstName: '<b>Ada</b>',
      farmName: 'A & B',
      reason: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
    expect(email.html).toContain('A &amp; B');
  });
});
