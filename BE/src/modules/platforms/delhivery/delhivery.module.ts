import { Module } from '@nestjs/common';
import { DelhiveryController } from './delhivery.controller';

@Module({ controllers: [DelhiveryController] })
export class DelhiveryModule {}
