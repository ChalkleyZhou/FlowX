import 'reflect-metadata';
import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function resolveLogLevels(): LogLevel[] {
  const configuredLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
  const supportedLevels: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

  if (!configuredLevel || !supportedLevels.includes(configuredLevel as LogLevel)) {
    return ['log', 'warn', 'error'];
  }

  const configuredIndex = supportedLevels.indexOf(configuredLevel as LogLevel);
  return supportedLevels.slice(0, configuredIndex + 1);
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: resolveLogLevels(),
  });
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST?.trim() || '0.0.0.0';
  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
