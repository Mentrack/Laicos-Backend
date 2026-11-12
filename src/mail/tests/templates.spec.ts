import {
  adminInviteEmail,
  agentInviteEmail,
  agentReinstatedEmail,
  agentRejectedEmail,
  agentSuspendedEmail,
  farmRejectedEmail,
  accountVerifiedEmail,
  applicationPendingEmail,
  farmerInviteEmail,
  informationRequestEmail,
  passwordResetEmail,
  orderReceivedEmail,
} from '../templates';

const loginUrl = 'https://app.laicos.ng/login';

describe('email templates', () => {
  it('invites a farmer with a link to set their password', () => {
    const setPasswordUrl = 'https://app.laicos.ng/reset-password?oobCode=abc';
    const email = farmerInviteEmail({ firstName: 'Ada', setPasswordUrl });
    expect(email.subject).toBe('Your farm is verified – welcome to LAICOS');
    for (const body of [email.html, email.text]) {
      expect(body).toContain('Ada');
      expect(body).toContain(setPasswordUrl);
      expect(body).not.toContain('Temporary password');
      expect(body).toContain('Forgot password');
    }
    expect(email.html).toContain('Set your password');
  });

  it('invites an admin with a link to set up their account', () => {
    const acceptUrl = 'https://app.laicos.ng/admin-invite?token=abc';
    const email = adminInviteEmail({
      acceptUrl,
      expiresAt: new Date('2026-11-16T12:00:00.000Z'),
    });
    expect(email.subject).toBe("You're invited to be a LAICOS admin");
    for (const body of [email.html, email.text]) {
      expect(body).toContain(acceptUrl);
      expect(body).not.toContain('Temporary password');
    }
    expect(email.html).toContain('Set up your account');
  });

  it('invites an extension agent with a link and the expiry date', () => {
    const acceptUrl = 'https://app.laicos.ng/agent-invite?token=abc';
    const email = agentInviteEmail({
      acceptUrl,
      expiresAt: new Date('2026-11-16T12:00:00.000Z'),
    });
    expect(email.subject).toBe("You're invited to be a LAICOS extension agent");
    for (const body of [email.html, email.text]) {
      expect(body).toContain(acceptUrl);
      expect(body).toContain('16 November 2026');
    }
  });

  it('tells someone who already has a password that they have full access', () => {
    const email = accountVerifiedEmail({ firstName: 'Ada', loginUrl });
    expect(email.text).toContain('You have been verified and have full access');
    expect(email.text).not.toMatch(/temporary password/i);
    expect(email.html).toContain(loginUrl);
  });

  it('says a completed form is pending review', () => {
    const email = applicationPendingEmail({ firstName: 'Ada' });
    expect(email.subject).toBe('Your form is pending review');
    expect(email.text).toContain('Your form is pending review');
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

  it('tells a rejected agent the reason, escaped in html', () => {
    const email = agentRejectedEmail({
      firstName: 'Musa',
      reason: 'ID <b>unreadable</b>',
    });
    expect(email.subject).toBe('We couldn’t approve your application');
    expect(email.text).toContain('ID <b>unreadable</b>');
    expect(email.html).toContain('ID &lt;b&gt;unreadable&lt;/b&gt;');
    expect(email.html).toContain('Musa');
  });

  it('tells a suspended agent the escaped reason and the end date', () => {
    const email = agentSuspendedEmail({
      firstName: 'Musa',
      reason: 'Repeated <b>late</b> visits',
      until: new Date('2026-12-01T09:00:00Z'),
    });
    expect(email.subject).toBe('Your LAICOS account has been suspended');
    for (const body of [email.html, email.text]) {
      expect(body).toContain('1 December 2026');
    }
    expect(email.text).toContain('Repeated <b>late</b> visits');
    expect(email.html).toContain('Repeated &lt;b&gt;late&lt;/b&gt; visits');
    expect(email.html).not.toContain('<b>late</b>');
    expect(email.html).toContain('Musa');
  });

  it('says a suspension without an end date lasts until further notice', () => {
    const email = agentSuspendedEmail({
      firstName: 'Musa',
      reason: 'Under investigation',
      until: null,
    });
    for (const body of [email.html, email.text]) {
      expect(body).toContain('until further notice');
    }
  });

  it('tells a reinstated agent their account is active and links to log in', () => {
    const email = agentReinstatedEmail({ firstName: 'Musa', loginUrl });
    expect(email.subject).toBe('Your LAICOS account is active again');
    for (const body of [email.html, email.text]) {
      expect(body).toContain(loginUrl);
    }
    expect(email.html).toContain('Musa');
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

  it('escapes the produce name in the order email', () => {
    const email = orderReceivedEmail({
      firstName: 'Ada',
      produceName: '<b>Maize</b>',
      forAgent: false,
    });
    expect(email.html).not.toContain('<b>Maize');
    expect(email.html).toContain('&lt;b&gt;Maize&lt;/b&gt;');
  });
});
