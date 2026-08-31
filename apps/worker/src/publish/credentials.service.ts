import { Injectable } from '@nestjs/common';
import { AppError, config, createLogger, isLocalLike } from '@cf/common';

/**
 * §4.8 1단계 — 채널 자격증명 조회.
 * 운영에서는 Secrets Manager 에서 credential_ref 경로로 읽는다.
 * 로컬에서는 실제 자격증명이 없으므로 참조 존재 여부만 확인하고 스텁을 돌려준다.
 * 코드·환경변수에 평문 자격증명을 두지 않는다는 §9.2 규칙은 어느 환경에서도 유지한다.
 */
@Injectable()
export class CredentialsService {
  private readonly log = createLogger('credentials');

  async resolve(credentialRef: string | null): Promise<Record<string, string>> {
    if (!credentialRef) {
      throw new AppError('PLATFORM_UPLOAD_FAILED', { message: '채널에 자격증명 참조가 설정되지 않았습니다.' });
    }

    if (isLocalLike() || config.adapters.mode === 'mock') {
      this.log.debug('using stub credentials for local run', { credentialRef });
      return { ref: credentialRef, accessToken: 'local-stub-token' };
    }

    if (!credentialRef.startsWith('secretsmanager://')) {
      throw new AppError('PLATFORM_UPLOAD_FAILED', {
        message: `지원하지 않는 자격증명 참조 형식입니다: ${credentialRef}`,
      });
    }

    // AWS 연결 시점에 @aws-sdk/client-secrets-manager 로 교체한다.
    throw new AppError('PLATFORM_UPLOAD_FAILED', {
      message: 'Secrets Manager 연동이 아직 구성되지 않았습니다.',
      details: [{ credentialRef }],
    });
  }
}
