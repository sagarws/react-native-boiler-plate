import { Module } from '@nestjs/common';
import { DesktopAppController } from './desktop-app.controller';

@Module({ controllers: [DesktopAppController] })
export class DesktopAppModule {}
