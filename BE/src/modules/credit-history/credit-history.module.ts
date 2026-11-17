import { Module } from '@nestjs/common';
import { CreditHistoryController } from './credit-history.controller';

@Module({ controllers: [CreditHistoryController] })
export class CreditHistoryModule {}
