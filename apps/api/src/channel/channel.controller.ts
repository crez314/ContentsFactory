import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import type { Request } from 'express';
import { CreateChannelDto, UpdateChannelDto } from '@cf/contracts';
import { Channel, Content, Publication } from '@cf/domain';
import { AppError, CurrentUser, MinRole, ReviewOnly, type AuthUser } from '@cf/common';
import { zodBody } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';

@ApiTags('channels')
@Controller()
export class ChannelController {
  constructor(private readonly ds: DataSource, private readonly audit: AuditService) {}

  @Get('channels')
  list() {
    return this.ds.getRepository(Channel).find({ order: { createdAt: 'ASC' } });
  }

  @Post('channels')
  @MinRole('ADMIN')
  create(@Body(zodBody(CreateChannelDto)) dto: z.infer<typeof CreateChannelDto>) {
    const repo = this.ds.getRepository(Channel);
    return repo.save(repo.create({ ...dto, status: 'ACTIVE' }));
  }

  @Patch('channels/:id')
  @MinRole('ADMIN')
  async update(@Param('id') id: string, @Body(zodBody(UpdateChannelDto)) dto: z.infer<typeof UpdateChannelDto>) {
    const repo = this.ds.getRepository(Channel);
    const channel = await repo.findOne({ where: { id } });
    if (!channel) throw new AppError('NOT_FOUND', { message: '채널을 찾을 수 없습니다.' });
    Object.assign(channel, dto);
    return repo.save(channel);
  }

  @Get('publications')
  list_publications() {
    return this.ds.getRepository(Publication).find({
      relations: { channel: true, content: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * §4.8 5단계 — 운영자가 백오피스에서 공개 전환.
   * V1 은 업로드를 PRIVATE 고정으로 하므로, 공개는 사람이 명시적으로 누른다.
   */
  @Post('publications/:id/publicize')
  @ReviewOnly()
  @ApiOperation({ summary: '비공개 → 공개 전환' })
  async publicize(
    @Param('id') id: string,
    @Body() body: { visibility?: 'PUBLIC' | 'UNLISTED' },
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const repo = this.ds.getRepository(Publication);
    const pub = await repo.findOne({ where: { id }, relations: { channel: true } });
    if (!pub) throw new AppError('NOT_FOUND', { message: '게시 기록을 찾을 수 없습니다.' });
    if (!['UPLOADED', 'PUBLISHED'].includes(pub.status)) {
      throw new AppError('CONFLICT', { message: `업로드가 완료된 게시만 공개 전환할 수 있습니다. (현재 ${pub.status})` });
    }

    const before = { visibility: pub.visibility, status: pub.status };
    pub.visibility = body?.visibility ?? 'PUBLIC';
    pub.status = 'PUBLISHED';
    pub.publishedAt = pub.publishedAt ?? new Date();
    await repo.save(pub);
    await this.ds.getRepository(Content).update(pub.contentId, { status: 'PUBLISHED' });

    // §9.2 게시는 감사 대상
    await this.audit.record({
      actor, action: 'PUBLICATION_PUBLICIZE', targetType: 'publication', targetId: id,
      before, after: { visibility: pub.visibility, status: pub.status }, ip: req.ip,
    });
    return pub;
  }
}
