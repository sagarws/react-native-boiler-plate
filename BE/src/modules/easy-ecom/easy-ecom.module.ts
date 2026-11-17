import { Module } from '@nestjs/common';
import { EasyEcomController } from './easy-ecom.controller';

@Module({ controllers: [EasyEcomController] })
export class EasyEcomModule {}
