import { Module } from '@nestjs/common';
import { AppSettingController } from './app-setting.controller';

@Module({ controllers: [AppSettingController] })
export class AppSettingModule {}
