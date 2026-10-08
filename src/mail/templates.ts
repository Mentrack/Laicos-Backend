export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '#0f8a5f';

/** Everything a user typed goes through this before it reaches HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(label: string, url: string): string {
  return `<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>`;
}

// Inline styles and a table: mail clients drop <style> blocks and most CSS.
function layout(title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1d2420">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
          <tr><td>
            <p style="margin:0 0 24px;font-weight:700;letter-spacing:2px;color:${BRAND}">LAICOS</p>
            <h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1>
            ${body}
            <p style="margin:32px 0 0;font-size:12px;color:#6b7570">You received this because of your LAICOS account. If this wasn’t you, ignore it or reply to let us know.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 14px;line-height:1.5">${html}</p>`;
}

export function farmerInviteEmail(input: {
  firstName: string;
  email: string;
  temporaryPassword: string;
  loginUrl: string;
}): RenderedEmail {
  const title = 'Your farm is verified';
  return {
    subject: 'Your farm is verified – welcome to LAICOS',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(
          'An agent has verified your farm, so your LAICOS account is ready. Log in with these details:',
        ),
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#f4f6f5;border-radius:12px;padding:16px;width:100%">
          <tr><td style="padding:4px 0;color:#6b7570">Email</td><td style="padding:4px 0;font-weight:600">${escapeHtml(input.email)}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7570">Temporary password</td><td style="padding:4px 0;font-weight:600;font-family:monospace">${escapeHtml(input.temporaryPassword)}</td></tr>
        </table>`,
        paragraph(
          'You’ll be asked to change your password as soon as you log in.',
        ),
        button('Log in', input.loginUrl),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      'An agent has verified your farm, so your LAICOS account is ready. Log in with these details:',
      '',
      `Email: ${input.email}`,
      `Temporary password: ${input.temporaryPassword}`,
      '',
      'You’ll be asked to change your password as soon as you log in.',
      '',
      `Log in: ${input.loginUrl}`,
    ].join('\n'),
  };
}

export function farmerVerifiedGoogleEmail(input: {
  firstName: string;
  loginUrl: string;
}): RenderedEmail {
  const title = 'Your farm is verified';
  return {
    subject: 'Your farm is verified – welcome to LAICOS',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(
          'An agent has verified your farm, so your LAICOS account is ready. Sign in with the Google account you signed up with.',
        ),
        button('Sign in with Google', input.loginUrl),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      'An agent has verified your farm, so your LAICOS account is ready. Sign in with the Google account you signed up with.',
      '',
      `Sign in: ${input.loginUrl}`,
    ].join('\n'),
  };
}

export function farmRejectedEmail(input: {
  firstName: string;
  farmName: string;
  reason: string;
}): RenderedEmail {
  const title = 'We couldn’t verify your farm';
  return {
    subject: `We couldn’t verify ${input.farmName}`,
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(
          `The agent who visited <strong>${escapeHtml(input.farmName)}</strong> couldn’t verify it. Their reason:`,
        ),
        `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:4px solid ${BRAND};background:#f4f6f5;border-radius:8px">${escapeHtml(input.reason)}</blockquote>`,
        paragraph('Our team will be in touch about what happens next.'),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      `The agent who visited ${input.farmName} couldn’t verify it. Their reason:`,
      '',
      input.reason,
      '',
      'Our team will be in touch about what happens next.',
    ].join('\n'),
  };
}

export function passwordResetEmail(input: {
  firstName: string;
  resetUrl: string;
}): RenderedEmail {
  const title = 'Reset your password';
  return {
    subject: 'Reset your LAICOS password',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(
          'We received a request to reset your password. The link expires in an hour.',
        ),
        button('Reset password', input.resetUrl),
        paragraph(
          'If you didn’t ask for this, you can ignore this email; your password stays the same.',
        ),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      'We received a request to reset your password. The link expires in an hour.',
      '',
      `Reset password: ${input.resetUrl}`,
      '',
      'If you didn’t ask for this, you can ignore this email; your password stays the same.',
    ].join('\n'),
  };
}

export function emailVerificationCodeEmail(input: {
  firstName: string;
  code: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const title = 'Verify your email';
  const lifetime = `It expires in ${input.expiresInMinutes} minutes.`;
  const ignore =
    'If you didn’t create a LAICOS account, you can ignore this email.';
  return {
    subject: `${input.code} is your LAICOS verification code`,
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(`Enter this code to verify your email. ${lifetime}`),
        `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND}">${escapeHtml(input.code)}</p>`,
        paragraph(ignore),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      `Enter this code to verify your email. ${lifetime}`,
      '',
      input.code,
      '',
      ignore,
    ].join('\n'),
  };
}
