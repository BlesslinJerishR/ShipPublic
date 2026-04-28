import { Module } from '@nestjs/common';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { ImageRendererService } from './image-renderer.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [GalleryController],
  providers: [GalleryService, ImageRendererService],
  exports: [GalleryService, ImageRendererService],
})
export class GalleryModule {}
