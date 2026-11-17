import { Module } from '@nestjs/common';
import { MarketingSiteController } from './marketing-site.controller';

@Module({ controllers: [MarketingSiteController] })
export class MarketingSiteModule {}
