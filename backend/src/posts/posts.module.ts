import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostsProcessor } from './posts.processor';
import { GithubModule } from '../github/github.module';
import { OllamaModule } from '../ollama/ollama.module';
import { CommitsModule } from '../commits/commits.module';
import { AuthModule } from '../auth/auth.module';
import { GalleryModule } from '../gallery/gallery.module';

export const POSTS_QUEUE = 'posts-generation';

@Module({
  imports: [
    BullModule.registerQueue({ name: POSTS_QUEUE }),
    GithubModule,
    OllamaModule,
    CommitsModule,
    AuthModule,
    GalleryModule,
  ],
  controllers: [PostsController],
  providers: [PostsService, PostsProcessor],
  exports: [PostsService, BullModule],
})
export class PostsModule {}
