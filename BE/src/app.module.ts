import { Module } from '@nestjs/common';
import { RootController } from './root.controller';
import { CommonModule } from './modules/common/common.module';
import { BaseLinkModule } from './modules/base-link/base-link.module';
import { PlanModule } from './modules/plan/plan.module';
import { RoleModule } from './modules/role/role.module';
import { ContactModule } from './modules/contact/contact.module';
import { ClaimHistoryModule } from './modules/claim-history/claim-history.module';
import { CreditHistoryModule } from './modules/credit-history/credit-history.module';
import { StorageHistoryModule } from './modules/storage-history/storage-history.module';
import { AccountModule } from './modules/account/account.module';
import { VideoLinkModule } from './modules/video-link/video-link.module';
import { ReferralModule } from './modules/referral/referral.module';
import { CreditsModule } from './modules/credits/credits.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FeedModule } from './modules/feed/feed.module';
import { UserModule } from './modules/user/user.module';
import { CompanyModule } from './modules/company/company.module';
import { AppSettingModule } from './modules/app-setting/app-setting.module';

@Module({
  imports: [CommonModule, BaseLinkModule, PlanModule, RoleModule, ContactModule, ClaimHistoryModule, CreditHistoryModule, StorageHistoryModule, AccountModule, VideoLinkModule, ReferralModule, CreditsModule, DashboardModule, FeedModule, UserModule, CompanyModule, AppSettingModule],
  controllers: [RootController],
})
export class AppModule {}
