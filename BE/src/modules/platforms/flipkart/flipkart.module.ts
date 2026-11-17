import { Module } from '@nestjs/common';
import { FlipkartController } from './flipkart.controller';

@Module({ controllers: [FlipkartController] })
export class FlipkartModule {}
