import { Module } from '@nestjs/common';
import { MasterImportSettingController } from './master-import-setting.controller';

@Module({ controllers: [MasterImportSettingController] })
export class MasterImportSettingModule {}
