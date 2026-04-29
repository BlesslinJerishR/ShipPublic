import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { NewsProcessor } from './news.processor';
import { RssService } from './rss.service';
import { ComfyUIService } from './comfyui.service';
import { OllamaModule } from '../ollama/ollama.module';
import { GalleryModule } from '../gallery/gallery.module';
import { AuthModule } from '../auth/auth.module';

export const NEWS_QUEUE = 'news-generation';

@Module({
  imports: [
    BullModule.registerQueue({ name: NEWS_QUEUE }),
    OllamaModule,
    GalleryModule,
    AuthModule,
  ],
  controllers: [NewsController],
  providers: [NewsService, NewsProcessor, RssService, ComfyUIService],
  exports: [NewsService],
})
export class NewsModule {}
