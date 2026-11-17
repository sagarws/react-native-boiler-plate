import { Module } from '@nestjs/common';
import { BaseLinkController } from './base-link.controller';

@Module({ controllers: [BaseLinkController] })
export class BaseLinkModule {}
