import { Module } from '@nestjs/common';
import { RazorpayController } from './razorpay.controller';

@Module({ controllers: [RazorpayController] })
export class RazorpayModule {}
