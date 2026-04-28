import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { CommitsModule } from './commits/commits.module';
import { PostsModule } from './posts/posts.module';
import { OllamaModule } from './ollama/ollama.module';
import { GithubModule } from './github/github.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { GalleryModule } from './gallery/gallery.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    GithubModule,
    OllamaModule,
    AuthModule,
    ProjectsModule,
    CommitsModule,
    PostsModule,
    WebhooksModule,
    GalleryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
