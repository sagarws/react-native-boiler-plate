import { Module } from '@nestjs/common';
import { TdsController } from './tds.controller';

@Module({ controllers: [TdsController] })
export class TdsModule {}
