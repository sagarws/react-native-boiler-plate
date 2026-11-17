import { Module } from '@nestjs/common';
import { AjioController } from './ajio.controller';

@Module({ controllers: [AjioController] })
export class AjioModule {}
