import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { createMailTransport } from './transports/create-mail-transport';
import { MAIL_TRANSPORT } from './transports/mail-transport';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: createMailTransport,
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
