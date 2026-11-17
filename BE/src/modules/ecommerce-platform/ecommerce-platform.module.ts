import { Module } from '@nestjs/common';
import { ECommercePlatformController } from './ecommerce-platform.controller';

@Module({ controllers: [ECommercePlatformController] })
export class ECommercePlatformModule {}
