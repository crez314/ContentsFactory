import { z } from 'zod';

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const RefreshDto = z.object({ refreshToken: z.string().min(10) });
export type RefreshDto = z.infer<typeof RefreshDto>;
