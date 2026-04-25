import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
  });

  const fastify = adapter.getInstance();
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: any, body: Buffer, done: any) => {
      try {
        req.rawBody = body;
        const json = body.length ? JSON.parse(body.toString('utf8')) : {};
        done(null, json);
      } catch (err) {
        done(err, undefined);
      }
    },
  );

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true },
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  await app.register(fastifyCookie as any, {
    secret: process.env.JWT_SECRET || 'dev-cookie-secret',
  });

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  await app.register(fastifyCors as any, {
    origin: [frontendUrl],
    credentials: true,
  });

  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Shipublic API listening on :${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
