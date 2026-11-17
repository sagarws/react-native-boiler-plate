import { Module } from '@nestjs/common';
import { RootController } from './root.controller';
import { CommonModule } from './modules/common/common.module';
import { BaseLinkModule } from './modules/base-link/base-link.module';
import { PlanModule } from './modules/plan/plan.module';
import { RoleModule } from './modules/role/role.module';
import { ContactModule } from './modules/contact/contact.module';
import { ClaimHistoryModule } from './modules/claim-history/claim-history.module';
import { CreditHistoryModule } from './modules/credit-history/credit-history.module';

@Module({
  imports: [CommonModule, BaseLinkModule, PlanModule, RoleModule, ContactModule, ClaimHistoryModule, CreditHistoryModule],
  controllers: [RootController],
})
export class AppModule {}
