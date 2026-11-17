import { Module } from '@nestjs/common';
import { SnapdealController } from './snapdeal.controller';

@Module({ controllers: [SnapdealController] })
export class SnapdealModule {}
