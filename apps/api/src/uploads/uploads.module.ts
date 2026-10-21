import { BadRequestException, Controller, Post, UseGuards, UseInterceptors, UploadedFile, Module } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

// Attachments are meant for documents/images (checklists, contracts, screenshots) — never anything a
// browser would execute or render as a page. Without this, any authenticated user could upload e.g.
// an .html or .svg file (SVGs can carry <script>) and get back a same-origin URL; opened by anyone
// else (an attachment link elsewhere in the app), it would run as script in the app's own origin —
// stored XSS straight to session-token theft, since auth tokens live in localStorage.
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip']);

@UseGuards(JwtAuthGuard)
@Controller('uploads')
class UploadsController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => cb(null, randomBytes(8).toString('hex') + extname(file.originalname).toLowerCase()),
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) return cb(new BadRequestException(`File type "${ext || '(none)'}" isn't allowed.`), false);
        cb(null, true);
      },
    }),
  )
  upload(@UploadedFile() file: { filename: string; originalname: string }) {
    return { path: `/uploads/${file.filename}`, name: file.originalname };
  }
}

@Module({ controllers: [UploadsController] })
export class UploadsModule {}
