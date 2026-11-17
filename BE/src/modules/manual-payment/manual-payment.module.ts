import { Module } from '@nestjs/common';
import { ManualPaymentController } from './manual-payment.controller';

@Module({ controllers: [ManualPaymentController] })
export class ManualPaymentModule {}
