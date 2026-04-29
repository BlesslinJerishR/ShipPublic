import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User, NewsItemStatus, PostPlatform } from '@prisma/client';
import {
  CreateSourceInput,
  GenerateNewsPostInput,
  NewsService,
  RefreshInput,
  UpdateSourceInput,
} from './news.service';

@UseGuards(JwtAuthGuard)
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  // ----- Sources -----

  @Get('sources')
  listSources(@CurrentUser() user: User) {
    return this.news.listSources(user.id);
  }

  @Post('sources')
  createSource(@CurrentUser() user: User, @Body() body: CreateSourceInput) {
    return this.news.createSource(user.id, body);
  }

  @Patch('sources/:id')
  updateSource(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateSourceInput,
  ) {
    return this.news.updateSource(user.id, id, body || {});
  }

  @Delete('sources/:id')
  deleteSource(@CurrentUser() user: User, @Param('id') id: string) {
    return this.news.deleteSource(user.id, id);
  }

  // ----- Items -----

  @Get('items')
  listItems(
    @CurrentUser() user: User,
    @Query('sourceId') sourceId?: string,
    @Query('status') status?: NewsItemStatus,
    @Query('take') take?: string,
  ) {
    return this.news.listItems(user.id, {
      sourceId,
      status,
      take: take ? Number(take) : undefined,
    });
  }

  @Patch('items/:id/dismiss')
  dismiss(@CurrentUser() user: User, @Param('id') id: string) {
    return this.news.dismissItem(user.id, id);
  }

  @Post('refresh')
  refresh(@CurrentUser() user: User, @Body() body: RefreshInput = {}) {
    return this.news.refresh(user.id, body || {});
  }

  // ----- Generation -----

  @Post('generate')
  generate(
    @CurrentUser() user: User,
    @Body()
    body: {
      newsItemIds: string[];
      platform?: PostPlatform;
      tone?: string;
      assetId?: string | null;
    },
  ) {
    return this.news.enqueueGeneration(user.id, body as GenerateNewsPostInput);
  }
}
