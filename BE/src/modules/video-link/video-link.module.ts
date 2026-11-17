import { Module } from '@nestjs/common';
import { VideoLinkController } from './video-link.controller';

@Module({ controllers: [VideoLinkController] })
export class VideoLinkModule {}
