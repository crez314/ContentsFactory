import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import type { Request } from 'express';
import { DecisionDto, RegenerateDto } from '@cf/contracts';
import { CurrentUser, MinRole, ReviewOnly, type AuthUser } from '@cf/common';
import { ContentService } from './content.service';
import { ApprovalService } from '@cf/orchestration';
import { zodBody } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';


@ApiTags('contents')
@Controller('contents')
export class ContentController {
  constructor(
    private readonly contents: ContentService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '콘텐츠 목록 (상태 필터)' })
  list(@Query() q: Record<string, string>) {
    return this.contents.list(q);
  }

  @Get('approval-queue')
  @ApiOperation({ summary: '승인 대기열' })
  queue(@Query('limit') limit?: string) {
    return this.contents.approvalQueue(Number(limit) || 50);
  }

  @Get(':id')
  @ApiOperation({ summary: '콘텐츠 상세 (Scene·QC·계보 포함)' })
  findOne(@Param('id') id: string) {
    return this.contents.findOne(id);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: '미리보기 서명 URL' })
  preview(@Param('id') id: string) {
    return this.contents.previewUrl(id);
  }

  @Get(':id/lineage')
  @ApiOperation({ summary: '콘텐츠 계보 조회' })
  lineage(@Param('id') id: string) {
    return this.contents.lineage(id);
  }

  @Post(':id/approve')
  @ReviewOnly()
  @ApiOperation({ summary: '승인 (4-eyes: 본인 오더는 불가)' })
  async approve(
    @Param('id') id: string,
    @Body(zodBody(DecisionDto)) dto: z.infer<typeof DecisionDto>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const result = await this.approvals.approve(id, actor, dto.comment);
    await this.audit.record({ actor, action: 'CONTENT_APPROVE', targetType: 'content', targetId: id, after: dto, ip: req.ip });
    return result;
  }

  @Post(':id/reject')
  @ReviewOnly()
  @ApiOperation({ summary: '반려' })
  async reject(
    @Param('id') id: string,
    @Body(zodBody(DecisionDto)) dto: z.infer<typeof DecisionDto>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const result = await this.approvals.reject(id, actor, dto.comment);
    await this.audit.record({ actor, action: 'CONTENT_REJECT', targetType: 'content', targetId: id, after: dto, ip: req.ip });
    return result;
  }

  @Post(':id/regenerate')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '부분 재생성 요청' })
  regenerate(@Param('id') id: string, @Body(zodBody(RegenerateDto)) dto: z.infer<typeof RegenerateDto>) {
    return this.contents.regenerate(id, dto);
  }
}
