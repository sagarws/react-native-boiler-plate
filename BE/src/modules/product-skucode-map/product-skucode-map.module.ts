import { Module } from '@nestjs/common';
import { ProductSkucodeMapController } from './product-skucode-map.controller';

@Module({ controllers: [ProductSkucodeMapController] })
export class ProductSkucodeMapModule {}
