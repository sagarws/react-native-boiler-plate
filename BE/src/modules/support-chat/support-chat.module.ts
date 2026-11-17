import { Module } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';

@Module({ controllers: [SupportChatController] })
export class SupportChatModule {}
