import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { initErrorReporting } from './common/error-reporting';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function main(): Promise<void> {
  // rawBody: webhook signatures (Click/Telegram/MoySklad) must be verified against exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app);
  const env = app.get<Env>(ENV);
  initErrorReporting(env);
  await app.listen(env.PORT, '0.0.0.0');
}

void main();
