import { Module } from '@nestjs/common';
import { TataCliqController } from './tatacliq.controller';

@Module({ controllers: [TataCliqController] })
export class TataCliqModule {}
