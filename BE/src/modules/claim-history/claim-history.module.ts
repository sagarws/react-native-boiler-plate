import { Module } from '@nestjs/common';
import { ClaimHistoryController } from './claim-history.controller';

@Module({ controllers: [ClaimHistoryController] })
export class ClaimHistoryModule {}
