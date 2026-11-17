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
import { NotificationModule } from './modules/notification/notification.module';
import { TemplateModule } from './modules/template/template.module';
import { TdsModule } from './modules/tds/tds.module';
import { ECommercePlatformModule } from './modules/ecommerce-platform/ecommerce-platform.module';
import { ProductSkucodeMapModule } from './modules/product-skucode-map/product-skucode-map.module';
import { MasterImportSettingModule } from './modules/master-import-setting/master-import-setting.module';
import { MarketingSiteModule } from './modules/marketing-site/marketing-site.module';
import { ManualPaymentModule } from './modules/manual-payment/manual-payment.module';
import { RazorpayModule } from './modules/razorpay/razorpay.module';
import { FilesModule } from './modules/files/files.module';
import { ImportsModule } from './modules/imports/imports.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { EmailModule } from './modules/email/email.module';
import { MailboxModule } from './modules/mailbox/mailbox.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { GoogleDriveModule } from './modules/google-drive/google-drive.module';
import { EasyEcomModule } from './modules/easy-ecom/easy-ecom.module';

@Module({
  imports: [CommonModule, BaseLinkModule, PlanModule, RoleModule, ContactModule, ClaimHistoryModule, CreditHistoryModule, StorageHistoryModule, AccountModule, VideoLinkModule, ReferralModule, CreditsModule, DashboardModule, FeedModule, UserModule, CompanyModule, AppSettingModule, NotificationModule, TemplateModule, TdsModule, ECommercePlatformModule, ProductSkucodeMapModule, MasterImportSettingModule, MarketingSiteModule, ManualPaymentModule, RazorpayModule, FilesModule, ImportsModule, WebhookModule, EmailModule, MailboxModule, WhatsAppModule, SupportChatModule, GoogleDriveModule, EasyEcomModule],
  controllers: [RootController],
})
export class AppModule {}
