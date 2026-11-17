import { Module } from '@nestjs/common';
import { MailboxController } from './mailbox.controller';
import { PasswordMailboxController } from './password-mailbox.controller';

@Module({ controllers: [MailboxController, PasswordMailboxController] })
export class MailboxModule {}
