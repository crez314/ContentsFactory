import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import type { Request } from 'express';
import { CreateUploadUrlDto, UpdateAttributesDto, UpsertLicenseDto } from '@cf/contracts';
import { type AttributeName } from '@cf/domain';
import { CurrentUser, MinRole, type AuthUser } from '@cf/common';
import { AssetService, type AssetSearchQuery } from './asset.service';
import { zodBody } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';

/** 쿼리스트링의 attr.angle=front,side_left 를 { angle: ['front','side_left'] } 로 만든다. */
function parseAttrQuery(query: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('attr.') || typeof v !== 'string' || !v) continue;
    out[k.slice(5)] = v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

@ApiTags('assets')
@Controller('assets')
export class AssetController {
  constructor(private readonly assets: AssetService, private readonly audit: AuditService) {}

  @Post('upload-url')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '업로드 URL 발급' })
  createUploadUrl(@Body(zodBody(CreateUploadUrlDto)) dto: z.infer<typeof CreateUploadUrlDto>) {
    return this.assets.createUploadUrl(dto);
  }

  @Post(':id/complete')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '업로드 완료 처리' })
  complete(@Param('id') id: string) {
    return this.assets.completeUpload(id);
  }

  @Get('coverage')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '속성 조합별 보유 현황 (히트맵)' })
  coverage(@Query() q: { artistId?: string; row?: string; col?: string }) {
    return this.assets.coverage(
      q.artistId,
      (q.row ?? 'angle') as AttributeName,
      (q.col ?? 'background') as AttributeName,
    );
  }

  @Get()
  @ApiOperation({ summary: '자산 검색 (속성·라이선스·품질 필터)' })
  search(@Query() q: Record<string, string>) {
    const query: AssetSearchQuery = { ...q, attrs: parseAttrQuery(q) };
    return this.assets.search(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '자산 상세' })
  findOne(@Param('id') id: string) {
    return this.assets.findOne(id);
  }

  @Patch(':id/attributes')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '태그 수정' })
  updateAttributes(@Param('id') id: string, @Body(zodBody(UpdateAttributesDto)) dto: z.infer<typeof UpdateAttributesDto>) {
    return this.assets.updateAttributes(id, dto.attributes, { markReviewed: dto.markReviewed });
  }

  @Post(':id/license')
  @MinRole('ADMIN')
  @ApiOperation({ summary: '라이선스 등록·갱신' })
  async upsertLicense(
    @Param('id') id: string,
    @Body(zodBody(UpsertLicenseDto)) dto: z.infer<typeof UpsertLicenseDto>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const result = await this.assets.upsertLicense(id, dto);
    // §9.2 라이선스 변경은 감사 대상
    await this.audit.record({
      actor, action: 'LICENSE_UPSERT', targetType: 'asset', targetId: id, after: dto, ip: req.ip,
    });
    return result;
  }
}
