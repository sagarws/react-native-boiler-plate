import { Module } from '@nestjs/common';
import { MeeshoController } from './meesho.controller';

@Module({ controllers: [MeeshoController] })
export class MeeshoModule {}
