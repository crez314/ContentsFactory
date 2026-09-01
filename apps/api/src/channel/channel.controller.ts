import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import type { Request } from 'express';
import { CreateChannelDto, UpdateChannelDto } from '@cf/contracts';
import { Channel, ChannelHealthLog, Content, Publication } from '@cf/domain';
import { ChannelHealthService } from '@cf/orchestration';
import { AppError, CurrentUser, MinRole, ReviewOnly, type AuthUser } from '@cf/common';
import { zodBody } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';

@ApiTags('channels')
@Controller()
export class ChannelController {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly health: ChannelHealthService,
  ) {}

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

  // ─────────────────────────────── §4.9 Channel Health

  @Get('channels/health')
  @ApiOperation({ summary: '전 채널 건강 상태 + 오늘 남은 게시 여유' })
  async healthOverview() {
    const channels = await this.ds.getRepository(Channel).find({ order: { createdAt: 'ASC' } });
    return Promise.all(
      channels.map(async (c) => ({
        id: c.id,
        platform: c.platform,
        handle: c.handle,
        status: c.status,
        healthState: c.healthState,
        dailyCap: c.dailyCap,
        minIntervalMin: c.minIntervalMin,
        observedSafeMax: c.observedSafeMax,
        quarantinedAt: c.quarantinedAt,
        quarantineReason: c.quarantineReason,
        headroom: await this.health.headroom(c.id),
      })),
    );
  }

  @Get('channels/:id/health')
  @ApiOperation({ summary: '채널 건강 상세 + 일일 관측 이력' })
  async channelHealth(@Param('id') id: string) {
    const logs = await this.ds.getRepository(ChannelHealthLog).find({
      where: { channelId: id },
      order: { observedOn: 'DESC' },
      take: 30,
    });
    return { headroom: await this.health.headroom(id), logs };
  }

  @Post('channels/:id/observe')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '오늘 관측 실행 → 상태 판정 (일일 배치가 호출)' })
  async observe(@Param('id') id: string) {
    const state = await this.health.observeToday(id);
    return { channelId: id, state, headroom: await this.health.headroom(id) };
  }

  @Post('channels/:id/quarantine')
  @MinRole('ADMIN')
  @ApiOperation({ summary: '채널 격리 — 게시 중단' })
  async quarantine(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const ch = await this.health.quarantine(id, body?.reason ?? 'manual');
    await this.audit.record({
      actor, action: 'CHANNEL_QUARANTINE', targetType: 'channel', targetId: id,
      after: { reason: ch.quarantineReason }, ip: req.ip,
    });
    return ch;
  }

  @Post('channels/:id/release')
  @MinRole('ADMIN')
  @ApiOperation({ summary: '격리 해제 — 자동으로는 일어나지 않는다' })
  async release(
    @Param('id') id: string,
    @Body() body: { dailyCap?: number },
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.ds.getRepository(Channel).findOne({ where: { id } });
    const ch = await this.health.release(id, body?.dailyCap);
    await this.audit.record({
      actor, action: 'CHANNEL_RELEASE', targetType: 'channel', targetId: id,
      before: { healthState: before?.healthState, quarantineReason: before?.quarantineReason },
      after: { healthState: ch.healthState, dailyCap: ch.dailyCap }, ip: req.ip,
    });
    return ch;
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
