import { z } from 'zod';
import {
  AGENT_KIND, AGENT_LIFECYCLE, ARTIST_STATUS, CHANNEL_STATUS, PLATFORM, USER_ROLE,
} from '@cf/domain';

export const CreateUserDto = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  password: z.string().min(8),
  role: z.enum(USER_ROLE),
});
export const UpdateUserDto = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.enum(USER_ROLE).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  password: z.string().min(8).optional(),
});

export const CreateArtistDto = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(2).max(30),
});
export const UpdateArtistDto = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(ARTIST_STATUS).optional(),
});

export const CreateAgentDto = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(AGENT_KIND),
  profile: z.record(z.string(), z.unknown()).default({}),
  approvalLevel: z.number().int().min(0).max(3).default(0),
  dailyBudget: z.number().nonnegative().default(0),
  monthlyBudget: z.number().nonnegative().default(0),
});
export const UpdateAgentDto = CreateAgentDto.partial().extend({
  lifecycle: z.enum(AGENT_LIFECYCLE).optional(),
});

/** §2.2 channels.spec */
export const ChannelSpecDto = z.object({
  aspect: z.string().optional(),
  maxDurationSec: z.number().int().positive().optional(),
  captionLimit: z.number().int().positive().optional(),
  maxHashtags: z.number().int().positive().optional(),
  maxFileSizeMb: z.number().int().positive().optional(),
  supportsPrivateUpload: z.boolean().optional(),
}).default({});

export const CreateChannelDto = z.object({
  platform: z.enum(PLATFORM),
  handle: z.string().min(1).max(120),
  segment: z.string().max(60).optional(),
  region: z.string().max(10).optional(),
  spec: ChannelSpecDto,
  credentialRef: z.string().max(200).optional(),
});
export const UpdateChannelDto = CreateChannelDto.partial().extend({
  status: z.enum(CHANNEL_STATUS).optional(),
});

export const MasterAttributeDto = z.object({
  attribute: z.string().min(1).max(40),
  value: z.string().min(1).max(60),
  labelKo: z.string().max(60).optional(),
  sortOrder: z.number().int().default(0),
});

export const BannedTermDto = z.object({
  term: z.string().min(1).max(120),
  category: z.enum(['BRAND', 'POLICY', 'TOPIC']).default('BRAND'),
  severity: z.enum(['WARN', 'BLOCK']).default('WARN'),
  note: z.string().optional(),
});

export const EmergencyStopDto = z.object({
  active: z.boolean().default(true),
  reason: z.string().max(500).optional(),
});
