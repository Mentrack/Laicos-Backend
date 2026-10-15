import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../generated/client';
import { AuthService } from '../auth/auth.service';
import { temporaryPassword } from '../auth/utils/temporary-password';
import { webappUrl } from '../common/config';
import { MailService } from '../mail/mail.service';
import { adminInviteEmail } from '../mail/templates';
import { AdminService } from './admin.service';
import type { AdminProfileDto, InviteAdminDto } from './dto';

/**
 * Creates an admin from an existing admin's invite. The temporary password
 * is emailed once; PasswordChangeGuard holds them until they replace it.
 */
@Injectable()
export class AdminInviteService {
  private readonly logger = new Logger(AdminInviteService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly admins: AdminService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async invite(dto: InviteAdminDto): Promise<AdminProfileDto> {
    const password = temporaryPassword();
    const account = await this.auth.createFirebaseUser({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password,
      emailVerified: true,
    });
    let user: Awaited<ReturnType<AuthService['createLocalUser']>>;
    try {
      user = await this.auth.createLocalUser({
        firebaseUid: account.uid,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        role: Role.ADMIN,
        isVerified: true,
        agreedToTerms: true,
        mustChangePassword: true,
      });
    } catch (error) {
      await this.auth.deleteFirebaseUser(account.uid);
      throw error;
    }
    // The account stands without the email: rolling back would turn a retry
    // into a 409. Forgot-password still works.
    await this.mail
      .send(
        dto.email,
        adminInviteEmail({
          firstName: dto.firstName,
          email: dto.email,
          temporaryPassword: password,
          loginUrl: webappUrl(this.config, '/login'),
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Admin invite email not sent to user ${user.id}`,
          error,
        );
      });
    return this.admins.findMine(user);
  }
}
