import { Module } from '@nestjs/common';
import { OrderServerController } from './order-server.controller';

@Module({ controllers: [OrderServerController] })
export class OrderServerModule {}
