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

function lagosDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
}

export function adminInviteEmail(input: {
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  return inviteEmail({
    ...input,
    roleName: 'admin',
    intro:
      'An admin invited you to help run LAICOS. Set up your account to choose your name and password.',
  });
}

export function agentInviteEmail(input: {
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  return inviteEmail({
    ...input,
    roleName: 'extension agent',
    intro:
      'An admin invited you to join LAICOS as an extension agent. Set up your account to choose your name and password, then complete your application.',
  });
}

function inviteEmail(input: {
  acceptUrl: string;
  expiresAt: Date;
  roleName: string;
  intro: string;
}): RenderedEmail {
  const title = `You’re invited to be a LAICOS ${input.roleName}`;
  const expiry = `This link expires on ${lagosDate(input.expiresAt)}.`;
  return {
    subject: `You're invited to be a LAICOS ${input.roleName}`,
    html: layout(
      title,
      [
        paragraph(input.intro),
        button('Set up your account', input.acceptUrl),
        paragraph(expiry),
      ].join('\n'),
    ),
    text: [
      input.intro,
      '',
      `Set up your account: ${input.acceptUrl}`,
      '',
      expiry,
    ].join('\n'),
  };
}

export function farmerInviteEmail(input: {
  firstName: string;
  setPasswordUrl: string;
}): RenderedEmail {
  const title = 'Your farm is verified';
  const intro =
    'An agent has verified your farm, so your LAICOS account is ready. Set your password to log in.';
  const expiry =
    'The link expires in an hour; after that, use Forgot password on the login page.';
  return {
    subject: 'Your farm is verified – welcome to LAICOS',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(intro),
        button('Set your password', input.setPasswordUrl),
        paragraph(expiry),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      intro,
      '',
      `Set your password: ${input.setPasswordUrl}`,
      '',
      expiry,
    ].join('\n'),
  };
}

export function accountVerifiedEmail(input: {
  firstName: string;
  loginUrl: string;
}): RenderedEmail {
  const title = 'You have been verified';
  return {
    subject: 'You have been verified',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph('You have been verified and have full access.'),
        button('Log in', input.loginUrl),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      'You have been verified and have full access.',
      '',
      `Log in: ${input.loginUrl}`,
    ].join('\n'),
  };
}

export function applicationPendingEmail(input: {
  firstName: string;
}): RenderedEmail {
  const title = 'Your form is pending review';
  return {
    subject: 'Your form is pending review',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph('Your form is pending review.'),
      ].join('\n'),
    ),
    text: [`Hi ${input.firstName},`, '', 'Your form is pending review.'].join(
      '\n',
    ),
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

export function agentRejectedEmail(input: {
  firstName: string;
  reason: string;
}): RenderedEmail {
  const title = 'We couldn’t approve your application';
  return {
    subject: title,
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(
          'We reviewed your extension agent application and couldn’t approve it. The reason:',
        ),
        `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:4px solid ${BRAND};background:#f4f6f5;border-radius:8px">${escapeHtml(input.reason)}</blockquote>`,
        paragraph('Our team will be in touch about what happens next.'),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      'We reviewed your extension agent application and couldn’t approve it. The reason:',
      '',
      input.reason,
      '',
      'Our team will be in touch about what happens next.',
    ].join('\n'),
  };
}

export function agentSuspendedEmail(input: {
  firstName: string;
  reason: string;
  until: Date | null;
}): RenderedEmail {
  const title = 'Your account has been suspended';
  const duration = input.until
    ? `Your suspension lasts until ${lagosDate(input.until)}.`
    : 'Your suspension lasts until further notice.';
  const intro =
    'Your LAICOS extension agent account has been suspended. The reason:';
  return {
    subject: 'Your LAICOS account has been suspended',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(intro),
        `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:4px solid ${BRAND};background:#f4f6f5;border-radius:8px">${escapeHtml(input.reason)}</blockquote>`,
        paragraph(duration),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      intro,
      '',
      input.reason,
      '',
      duration,
    ].join('\n'),
  };
}

export function agentReinstatedEmail(input: {
  firstName: string;
  loginUrl: string;
}): RenderedEmail {
  const title = 'Your account is active again';
  const intro =
    'Your suspension has been lifted, and your LAICOS account is active again.';
  return {
    subject: 'Your LAICOS account is active again',
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(intro),
        button('Log in', input.loginUrl),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      intro,
      '',
      `Log in: ${input.loginUrl}`,
    ].join('\n'),
  };
}

export function informationRequestEmail(input: {
  firstName: string;
  farmCode: string;
  documents: string[];
  note: string;
}): RenderedEmail {
  const title = `Documents needed for ${input.farmCode}`;
  const names = input.documents.join(', ');
  return {
    subject: title,
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(
          `An admin needs these documents for ${escapeHtml(input.farmCode)} before the farm can be approved: ${escapeHtml(names)}.`,
        ),
        paragraph(escapeHtml(input.note)),
      ].join('\n'),
    ),
    text: [
      `Hi ${input.firstName},`,
      '',
      `An admin needs these documents for ${input.farmCode} before the farm can be approved: ${names}.`,
      '',
      input.note,
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

export function orderReceivedLine(
  produceName: string,
  forAgent: boolean,
): string {
  return `A buyer ordered ${produceName} from ${forAgent ? 'a farm you manage' : 'your farm'}.`;
}

export function orderReceivedEmail(input: {
  firstName: string;
  produceName: string;
  forAgent: boolean;
}): RenderedEmail {
  const subject = `New order: ${input.produceName}`;
  const line = orderReceivedLine(input.produceName, input.forAgent);
  return {
    subject,
    html: layout(
      'New order',
      [
        paragraph(`Hi ${escapeHtml(input.firstName)},`),
        paragraph(escapeHtml(line)),
        paragraph('Open LAICOS to see the details.'),
      ].join('\n'),
    ),
    text: `Hi ${input.firstName},\n\n${line}\n\nOpen LAICOS to see the details.`,
  };
}

function simpleEmail(input: {
  firstName: string;
  title: string;
  subject: string;
  lines: string[];
  quote?: string;
}): RenderedEmail {
  const { firstName, title, subject, lines, quote } = input;
  return {
    subject,
    html: layout(
      title,
      [
        paragraph(`Hi ${escapeHtml(firstName)},`),
        ...lines.map((line) => paragraph(escapeHtml(line))),
        ...(quote
          ? [
              `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:4px solid ${BRAND};background:#f4f6f5;border-radius:8px">${escapeHtml(quote)}</blockquote>`,
            ]
          : []),
      ].join('\n'),
    ),
    text: [
      `Hi ${firstName},`,
      '',
      ...lines.flatMap((line) => [line, '']),
      ...(quote ? [quote, ''] : []),
    ]
      .join('\n')
      .trimEnd(),
  };
}

export function orderShippedLine(
  produceName: string,
  orderNumber: string,
): string {
  return `Your order ${orderNumber} (${produceName}) is on its way.`;
}

export function orderShippedEmail(input: {
  firstName: string;
  orderNumber: string;
  produceName: string;
}): RenderedEmail {
  return simpleEmail({
    firstName: input.firstName,
    title: 'Your order has shipped',
    subject: `Order ${input.orderNumber} has shipped`,
    lines: [
      orderShippedLine(input.produceName, input.orderNumber),
      'Once the produce arrives, open LAICOS to confirm delivery, or report a problem if something is wrong.',
    ],
  });
}

export function disputeRaisedLine(orderNumber: string): string {
  return `A dispute was raised on order ${orderNumber}.`;
}

export function disputeRaisedEmail(input: {
  firstName: string;
  orderNumber: string;
  reason: string;
}): RenderedEmail {
  return simpleEmail({
    firstName: input.firstName,
    title: 'Dispute raised',
    subject: `Dispute raised on order ${input.orderNumber}`,
    lines: [disputeRaisedLine(input.orderNumber), 'The reason given:'],
    quote: input.reason,
  });
}

export function disputeResolvedLine(
  orderNumber: string,
  refundPercent: string,
): string {
  return `The dispute on order ${orderNumber} was resolved with a ${refundPercent}% refund.`;
}

export function disputeResolvedEmail(input: {
  firstName: string;
  orderNumber: string;
  refundPercent: string;
}): RenderedEmail {
  return simpleEmail({
    firstName: input.firstName,
    title: 'Dispute resolved',
    subject: `Dispute resolved on order ${input.orderNumber}`,
    lines: [
      disputeResolvedLine(input.orderNumber, input.refundPercent),
      'Open LAICOS to see the details.',
    ],
  });
}

export function refundProcessedLine(amount: string, currency: string): string {
  return `Your refund of ${amount} ${currency} has been processed.`;
}

export function refundProcessedEmail(input: {
  firstName: string;
  amount: string;
  currency: string;
}): RenderedEmail {
  return simpleEmail({
    firstName: input.firstName,
    title: 'Refund processed',
    subject: `Your refund of ${input.amount} ${input.currency} is on its way`,
    lines: [
      refundProcessedLine(input.amount, input.currency),
      'It can take a few days to reach your account, depending on your bank.',
    ],
  });
}

export function payoutPaidLine(reference: string, amount: string): string {
  return `Payout ${reference} of NGN ${amount} has been paid to your bank account.`;
}

export function payoutPaidEmail(input: {
  firstName: string;
  reference: string;
  amount: string;
}): RenderedEmail {
  return simpleEmail({
    firstName: input.firstName,
    title: 'Payout paid',
    subject: `Payout ${input.reference} paid`,
    lines: [payoutPaidLine(input.reference, input.amount)],
  });
}
