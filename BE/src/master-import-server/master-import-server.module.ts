import { Module } from '@nestjs/common';
import { MasterImportServerController } from './master-import-server.controller';

@Module({ controllers: [MasterImportServerController] })
export class MasterImportServerModule {}
