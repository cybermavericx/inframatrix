import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const webOrigins = (
    config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: webOrigins, credentials: true });

  // ── Single-port unified hosting: also serve the built web UI ──
  // WEB_DIST overrides; default is apps/web/dist relative to the API cwd (apps/api).
  // If the build isn't present we skip this and run API-only (classic split dev).
  const webDist =
    config.get<string>('WEB_DIST') ?? join(process.cwd(), '..', 'web', 'dist');
  const indexHtml = join(webDist, 'index.html');
  if (existsSync(indexHtml)) {
    app.useStaticAssets(webDist);
    const expressApp = app.getHttpAdapter().getInstance();
    // SPA fallback: any non-API, non-uploads GET that isn't a real file → index.html
    expressApp.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api/v1') || req.path.startsWith('/uploads'))
        return next();
      res.sendFile(indexHtml);
    });
    console.log(`Serving web UI from ${webDist}`);
  } else {
    console.log(`Web build not found at ${webDist} — running API only.`);
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  console.log(`Server on http://127.0.0.1:${port}  (UI: /   API: /api/v1)`);
}
bootstrap();
