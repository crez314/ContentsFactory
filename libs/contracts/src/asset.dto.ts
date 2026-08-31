import { z } from 'zod';
import { MEDIA_TYPE } from '@cf/domain';
import { IsoDate } from './common';

export const CreateUploadUrlDto = z.object({
  artistId: z.string().uuid(),
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(80),
  fileSize: z.number().int().positive(),
  mediaType: z.enum(MEDIA_TYPE),
});
export type CreateUploadUrlDto = z.infer<typeof CreateUploadUrlDto>;

export const UpdateAttributesDto = z.object({
  attributes: z.record(z.string(), z.string()),
  markReviewed: z.boolean().default(true),
});
export type UpdateAttributesDto = z.infer<typeof UpdateAttributesDto>;

export const UpsertLicenseDto = z.object({
  allowedChannels: z.array(z.string()).min(1),
  allowedRegions: z.array(z.string()).min(1),
  derivativeAllowed: z.boolean(),
  validFrom: IsoDate,
  validUntil: IsoDate,
  contractRef: z.string().max(120).optional(),
  note: z.string().optional(),
}).refine((v) => v.validUntil >= v.validFrom, {
  message: 'validUntil 은 validFrom 이후여야 합니다.',
  path: ['validUntil'],
});
export type UpsertLicenseDto = z.infer<typeof UpsertLicenseDto>;
