import { Module } from '@nestjs/common';
import { RootController } from './root.controller';
import { CommonModule } from './modules/common/common.module';
import { BaseLinkModule } from './modules/base-link/base-link.module';
import { PlanModule } from './modules/plan/plan.module';

@Module({
  imports: [CommonModule, BaseLinkModule, PlanModule],
  controllers: [RootController],
})
export class AppModule {}
