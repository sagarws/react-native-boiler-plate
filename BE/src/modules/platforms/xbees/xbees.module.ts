import { Module } from '@nestjs/common';
import { XbeesController } from './xbees.controller';

@Module({ controllers: [XbeesController] })
export class XbeesModule {}
