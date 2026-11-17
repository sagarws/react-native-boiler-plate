import { Module } from '@nestjs/common';
import { NykaaController } from './nykaa.controller';

@Module({ controllers: [NykaaController] })
export class NykaaModule {}
