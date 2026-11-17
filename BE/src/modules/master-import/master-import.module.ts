import { Module } from '@nestjs/common';
import { MasterImportController } from './master-import.controller';

@Module({ controllers: [MasterImportController] })
export class MasterImportModule {}
