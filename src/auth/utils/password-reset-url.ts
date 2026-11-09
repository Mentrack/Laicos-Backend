import { ConfigService } from '@nestjs/config';
import { webappUrl } from '../../common/config';

/**
 * Firebase's link opens Firebase's hosted page; the webapp has its own,
 * which posts the code to POST /auth/forgot-password/confirm.
 */
export function passwordResetUrl(
  config: ConfigService,
  firebaseLink: string,
): string {
  const oobCode = new URL(firebaseLink).searchParams.get('oobCode');
  if (!oobCode) {
    throw new Error('Firebase reset link has no oobCode');
  }
  return webappUrl(
    config,
    `/reset-password?oobCode=${encodeURIComponent(oobCode)}`,
  );
}
