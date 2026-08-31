import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import {
  Agent, Artist, Asset, AssetLicense, Channel, MasterAttributeValue, MasterBannedTerm, User,
  ATTRIBUTE_STANDARDS, ATTRIBUTE_LABELS_KO, type AttributeName,
} from '@cf/domain';
import { config, createLogger } from '@cf/common';
import { createStorageDriver } from '@cf/storage';
import { syntheticImage } from '@cf/model-abstraction';
import { getDataSource } from './data-source';

const log = createLogger('seed');

const DEMO_PASSWORD = 'crez1234!';

const USERS: Array<{ email: string; name: string; role: User['role'] }> = [
  { email: 'root@crez.local',     name: '슈퍼루트', role: 'SUPER_ROOT' },
  { email: 'admin@crez.local',    name: '관리자',   role: 'ADMIN' },
  { email: 'operator@crez.local', name: '운영자',   role: 'OPERATOR' },
  { email: 'reviewer@crez.local', name: '검수자',   role: 'REVIEWER' },
  { email: 'viewer@crez.local',   name: '조회자',   role: 'VIEWER' },
];

const CHANNELS = [
  {
    platform: 'YOUTUBE' as const, handle: '@crez_official', segment: 'F20', region: 'KR',
    spec: { aspect: '9:16', maxDurationSec: 60, captionLimit: 5000, maxHashtags: 15, supportsPrivateUpload: true },
    credentialRef: 'secretsmanager://crez/channels/youtube-official',
  },
  {
    platform: 'INSTAGRAM' as const, handle: '@crez_daily', segment: 'F20', region: 'KR',
    spec: { aspect: '9:16', maxDurationSec: 90, captionLimit: 2200, maxHashtags: 30, supportsPrivateUpload: false },
    credentialRef: 'secretsmanager://crez/channels/instagram-daily',
  },
  {
    platform: 'TIKTOK' as const, handle: '@crez_kr', segment: 'F10', region: 'KR',
    spec: { aspect: '9:16', maxDurationSec: 60, captionLimit: 2200, maxHashtags: 20, supportsPrivateUpload: true },
    credentialRef: 'secretsmanager://crez/channels/tiktok-kr',
  },
  {
    // 라이선스 지역 검증(LICENSE_CHANNEL_DENIED)을 재현하기 위한 일본 채널
    platform: 'INSTAGRAM' as const, handle: '@crez_jp', segment: 'F20', region: 'JP',
    spec: { aspect: '9:16', maxDurationSec: 90, captionLimit: 2200, maxHashtags: 30, supportsPrivateUpload: false },
    credentialRef: 'secretsmanager://crez/channels/instagram-jp',
  },
];

const AGENTS = [
  { name: '이미지 에이전트 A', kind: 'IMAGE' as const, approvalLevel: 1, dailyBudget: 200_000, monthlyBudget: 4_000_000,
    profile: { segment: 'F20', tone: 'casual', brand_style: 'crez_v1' } },
  { name: '영상 에이전트 A',   kind: 'VIDEO' as const, approvalLevel: 2, dailyBudget: 500_000, monthlyBudget: 9_000_000,
    profile: { segment: 'F20', tone: 'bright', brand_style: 'crez_v1' } },
  { name: '영상 에이전트 B(수동승인)', kind: 'VIDEO' as const, approvalLevel: 0, dailyBudget: 100_000, monthlyBudget: 2_000_000,
    profile: { segment: 'F10', tone: 'playful', brand_style: 'crez_v1' } },
];

const BANNED_TERMS = [
  { term: '무료증정',   category: 'BRAND'  as const, severity: 'WARN'  as const },
  { term: '최저가보장', category: 'BRAND'  as const, severity: 'WARN'  as const },
  { term: '도박',       category: 'POLICY' as const, severity: 'BLOCK' as const },
  { term: '의료효과',   category: 'POLICY' as const, severity: 'BLOCK' as const },
  { term: '100%보장',   category: 'TOPIC'  as const, severity: 'BLOCK' as const },
];

/** 속성 조합을 골고루 깔아 커버리지 히트맵(§7.2)이 의미 있게 보이도록 한다. */
function assetPlan(): Array<{ attrs: Record<string, string>; grade: 'A' | 'B' | 'C'; ageDays: number }> {
  const angles = ATTRIBUTE_STANDARDS.angle;
  const lightings = ATTRIBUTE_STANDARDS.lighting;
  const backgrounds = ATTRIBUTE_STANDARDS.background;
  const outfits = ATTRIBUTE_STANDARDS.outfit;
  const poses = ATTRIBUTE_STANDARDS.pose;
  const expressions = ATTRIBUTE_STANDARDS.expression;
  const grades: Array<'A' | 'B' | 'C'> = ['A', 'A', 'B', 'B', 'B', 'C'];

  const out = [];
  for (let i = 0; i < 60; i++) {
    out.push({
      attrs: {
        angle: angles[i % angles.length],
        lighting: lightings[(i * 3) % lightings.length],
        background: backgrounds[(i * 2) % backgrounds.length],
        outfit: outfits[i % outfits.length],
        pose: poses[(i * 5) % poses.length],
        expression: expressions[(i * 7) % expressions.length],
      },
      grade: grades[i % grades.length],
      ageDays: (i * 11) % 400,
    });
  }
  return out;
}

export async function seed(ds: DataSource): Promise<void> {
  const storage = createStorageDriver();

  // ── 사용자
  const userRepo = ds.getRepository(User);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, config.auth.bcryptCost);
  for (const u of USERS) {
    const existing = await userRepo.findOne({ where: { email: u.email } });
    if (existing) continue;
    await userRepo.insert({ ...u, passwordHash, status: 'ACTIVE' });
  }
  log.info('users seeded', { count: USERS.length });

  // ── 마스터 (속성 표준값 · 금지어)
  const attrRepo = ds.getRepository(MasterAttributeValue);
  for (const attribute of Object.keys(ATTRIBUTE_STANDARDS) as AttributeName[]) {
    const values = ATTRIBUTE_STANDARDS[attribute];
    for (let i = 0; i < values.length; i++) {
      await attrRepo
        .createQueryBuilder()
        .insert()
        .values({ attribute, value: values[i], labelKo: ATTRIBUTE_LABELS_KO[attribute], sortOrder: i })
        .orIgnore()
        .execute();
    }
  }
  const termRepo = ds.getRepository(MasterBannedTerm);
  for (const t of BANNED_TERMS) {
    await termRepo.createQueryBuilder().insert().values(t).orIgnore().execute();
  }
  log.info('master data seeded');

  // ── 채널
  const channelRepo = ds.getRepository(Channel);
  for (const c of CHANNELS) {
    const existing = await channelRepo.findOne({ where: { platform: c.platform, handle: c.handle } });
    if (!existing) await channelRepo.insert({ ...c, status: 'ACTIVE' });
  }
  log.info('channels seeded', { count: CHANNELS.length });

  // ── 에이전트
  const agentRepo = ds.getRepository(Agent);
  for (const a of AGENTS) {
    const existing = await agentRepo.findOne({ where: { name: a.name } });
    if (!existing) await agentRepo.insert({ ...a, lifecycle: 'ACTIVE' });
  }
  log.info('agents seeded', { count: AGENTS.length });

  // ── 아티스트 + 자산
  const artistRepo = ds.getRepository(Artist);
  let artist = await artistRepo.findOne({ where: { code: 'CREZ-A01' } });
  if (!artist) {
    artist = artistRepo.create({ name: '유나', code: 'CREZ-A01', status: 'ACTIVE' });
    await artistRepo.save(artist);
  }

  const assetRepo = ds.getRepository(Asset);
  const licenseRepo = ds.getRepository(AssetLicense);
  const existingCount = await assetRepo.count({ where: { artistId: artist.id } });

  if (existingCount === 0) {
    const plan = assetPlan();
    const today = new Date();
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const key = `assets/${artist.id}/seed-${String(i).padStart(3, '0')}.png`;
      const png = syntheticImage({ width: 1080, height: 1920, seed: `${artist.code}-${i}` });
      await storage.put(key, png, 'image/png');

      const shot = new Date(today.getTime() - p.ageDays * 86_400_000);
      const asset = assetRepo.create({
        artistId: artist.id,
        mediaType: 'PHOTO',
        storageKey: key,
        fileSize: png.length,
        mimeType: 'image/png',
        width: 1080,
        height: 1920,
        shotAt: shot.toISOString().slice(0, 10),
        attributes: p.attrs,
        qualityGrade: p.grade,
        taggingStatus: i % 7 === 0 ? 'PENDING' : 'AUTO_DONE',
        status: 'ACTIVE',
      });
      await assetRepo.save(asset);

      // 다섯 번째마다 KR 전용 라이선스를 발급해 JP 채널 검증 실패를 재현할 수 있게 한다.
      const krOnly = i % 5 === 0;
      // 열 번째마다 만료가 임박한 라이선스를 둔다 (대시보드 「주의 필요」 확인용).
      const expiring = i % 10 === 3;
      await licenseRepo.insert({
        assetId: asset.id,
        allowedChannels: ['youtube', 'instagram', 'tiktok', 'x'],
        allowedRegions: krOnly ? ['KR'] : ['KR', 'JP'],
        derivativeAllowed: i % 13 !== 0, // 열세 번째마다 2차가공 불허 (DERIVATIVE_DENIED 재현)
        validFrom: new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10),
        validUntil: new Date(today.getTime() + (expiring ? 20 : 540) * 86_400_000).toISOString().slice(0, 10),
        contractRef: `CTR-2026-${String(i).padStart(3, '0')}`,
      });
    }

    // Identity 기준값 — 품질 A 등급 상위 5장을 기준 세트로 삼는다 (§4.1)
    const refs = await assetRepo.find({
      where: { artistId: artist.id, qualityGrade: 'A' },
      order: { createdAt: 'ASC' },
      take: 5,
    });
    artist.identityRef = {
      refKeys: refs.map((r) => r.storageKey),
      vectorDim: 128,
      updatedAt: new Date().toISOString(),
    };
    await artistRepo.save(artist);
    log.info('assets seeded', { count: plan.length, identityRefs: refs.length });
  } else {
    log.info('assets already present, skipping', { count: existingCount });
  }
}

export async function runSeed(): Promise<void> {
  const ds = await getDataSource();
  await seed(ds);
}

export const SEED_CREDENTIALS = { password: DEMO_PASSWORD, users: USERS };
