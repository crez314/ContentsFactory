import { Controller, Get, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppError, Public, config, createLogger } from '@cf/common';
import { LocalStorageDriver, StorageService } from '@cf/storage';

/**
 * 로컬 스토리지 드라이버용 서명 URL 엔드포인트.
 * S3 Presigned URL 을 대체하며, prod(STORAGE_DRIVER=s3)에서는 이 경로가 쓰이지 않는다.
 * 서명·만료 검증을 통과한 요청만 파일에 접근할 수 있다 (§9.2).
 */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  private readonly log = createLogger('files');

  constructor(private readonly storage: StorageService) {}

  private driver(): LocalStorageDriver {
    const d = this.storage.driver;
    if (!(d instanceof LocalStorageDriver)) {
      throw new AppError('NOT_FOUND', { message: '이 엔드포인트는 local 스토리지에서만 동작합니다.' });
    }
    return d;
  }

  private verify(q: Record<string, string>, op: 'GET' | 'PUT'): string {
    const { key, exp, sig } = q;
    if (!key || !exp || !sig) throw new AppError('AUTH_FORBIDDEN', { message: '서명 파라미터가 없습니다.' });
    if (!this.driver().verify(key, Number(exp), op, sig)) {
      throw new AppError('AUTH_FORBIDDEN', { message: '서명이 유효하지 않거나 만료되었습니다.' });
    }
    return key;
  }

  @Public()
  @Get()
  async download(@Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    const key = this.verify(q, 'GET');
    const head = await this.storage.head(key);
    if (!head) throw new AppError('NOT_FOUND', { message: '파일이 없습니다.' });

    res.setHeader('Content-Type', contentTypeFor(key));
    res.setHeader('Content-Length', String(head.size));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(await this.storage.get(key));
  }

  @Public()
  @Put()
  async upload(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const key = this.verify(q, 'PUT');
    const chunks: Buffer[] = [];
    let bytes = 0;
    const MAX = 512 * 1024 * 1024;

    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX) {
          reject(new AppError('INVALID_INPUT', { message: '파일이 너무 큽니다 (512MB 초과).' }));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });

    await this.storage.put(key, Buffer.concat(chunks), req.header('content-type') ?? 'application/octet-stream');
    this.log.info('local upload stored', { key, bytes });
    res.status(200).json({ ok: true, key, bytes });
  }
}

function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'mp4': return 'video/mp4';
    case 'm4a': return 'audio/mp4';
    case 'mp3': return 'audio/mpeg';
    case 'srt': return 'application/x-subrip';
    case 'vtt': return 'text/vtt';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
}
