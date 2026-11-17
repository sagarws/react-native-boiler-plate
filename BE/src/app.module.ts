import { Module } from '@nestjs/common';
import { RootController } from './root.controller';
import { CommonModule } from './modules/common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [RootController],
})
export class AppModule {}
