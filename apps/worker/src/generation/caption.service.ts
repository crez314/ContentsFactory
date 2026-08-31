import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Blueprint, Channel, Content, MasterBannedTerm, Order } from '@cf/domain';
import { createLogger } from '@cf/common';

export interface Caption {
  title: string;
  description: string;
  hashtags: string[];
}

/**
 * 제목·설명·해시태그 생성.
 * V1 은 룰 기반이다 (§4.6 brand·aiRisk 와 같은 방침).
 * 채널 규격(캡션 길이·해시태그 수)에 맞춰 자르고, 금지어는 생성 시점에 제거한다.
 */
@Injectable()
export class CaptionService {
  private readonly log = createLogger('caption');

  constructor(private readonly ds: DataSource) {}

  async build(order: Order, blueprint: Blueprint, content: Content): Promise<Caption> {
    const channel = blueprint.channel
      ?? (await this.ds.getRepository(Channel).findOne({ where: { id: blueprintChannelId(blueprint) } }));

    const campaign = String(order.concept.campaign ?? 'CREZ');
    const story = String(order.concept.story ?? '').replace(/_/g, ' ').trim();
    const mood = String(order.concept.mood ?? '');

    const rawTitle = [campaign, story].filter(Boolean).join(' · ') || 'CREZ Content';
    const rawDescription = [
      story ? `${story}를 담았습니다.` : 'CREZ 콘텐츠입니다.',
      mood ? `분위기: ${mood}` : '',
      `#${campaign.replace(/\s+/g, '')}`,
    ].filter(Boolean).join('\n');

    const hashtagPool = [
      campaign.replace(/\s+/g, ''),
      ...story.split(/\s+/).filter(Boolean),
      mood,
      'CREZ',
    ].filter(Boolean).map((t) => `#${t.replace(/[^\w가-힣]/g, '')}`);

    const banned = await this.ds.getRepository(MasterBannedTerm).find();
    const strip = (s: string): string =>
      banned.reduce((acc, t) => acc.replace(new RegExp(escapeRegExp(t.term), 'gi'), ''), s).trim();

    const captionLimit = channel?.spec.captionLimit ?? 2200;
    const maxHashtags = channel?.spec.maxHashtags ?? 15;

    return {
      title: strip(rawTitle).slice(0, 200),
      description: strip(rawDescription).slice(0, captionLimit),
      hashtags: [...new Set(hashtagPool)].slice(0, maxHashtags),
    };
  }
}

function blueprintChannelId(bp: Blueprint): string {
  return bp.channelId;
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
