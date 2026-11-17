import { Module } from '@nestjs/common';
import { MyntraController } from './myntra.controller';

@Module({ controllers: [MyntraController] })
export class MyntraModule {}
