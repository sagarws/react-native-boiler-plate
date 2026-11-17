import { Module } from '@nestjs/common';
import { StorageHistoryController } from './storage-history.controller';

@Module({ controllers: [StorageHistoryController] })
export class StorageHistoryModule {}
