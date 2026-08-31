import {
  ORDER_STAGES, canTransitionContent, canTransitionOrder, canTransitionTask,
  contentStage, isContentTerminal,
} from '@cf/domain';

describe('§2.3 상태 정의', () => {
  describe('Order', () => {
    it('명세의 정상 경로를 허용한다', () => {
      expect(canTransitionOrder('DRAFT', 'VALIDATING')).toBe(true);
      expect(canTransitionOrder('VALIDATING', 'QUEUED')).toBe(true);
      expect(canTransitionOrder('VALIDATING', 'REJECTED')).toBe(true);
      expect(canTransitionOrder('QUEUED', 'RUNNING')).toBe(true);
      expect(canTransitionOrder('RUNNING', 'DONE')).toBe(true);
      expect(canTransitionOrder('RUNNING', 'PARTIAL')).toBe(true);
    });
    it('DRAFT 에서 바로 RUNNING 으로 갈 수 없다', () => {
      expect(canTransitionOrder('DRAFT', 'RUNNING')).toBe(false);
    });
    it('종료 상태에서는 나갈 수 없다', () => {
      expect(canTransitionOrder('DONE', 'RUNNING')).toBe(false);
      expect(canTransitionOrder('CANCELLED', 'QUEUED')).toBe(false);
    });
  });

  describe('Content', () => {
    it('생성→렌더→QC→승인→게시 경로를 허용한다', () => {
      expect(canTransitionContent('PENDING', 'GENERATING')).toBe(true);
      expect(canTransitionContent('GENERATING', 'RENDERING')).toBe(true);
      expect(canTransitionContent('RENDERING', 'QC')).toBe(true);
      expect(canTransitionContent('QC', 'READY')).toBe(true);
      expect(canTransitionContent('READY', 'APPROVED')).toBe(true);
      expect(canTransitionContent('APPROVED', 'PUBLISHING')).toBe(true);
      expect(canTransitionContent('PUBLISHING', 'PUBLISHED')).toBe(true);
    });
    it('QC 실패는 생성 단계로 되돌아갈 수 있다 (부분 재생성)', () => {
      expect(canTransitionContent('QC', 'QC_FAILED')).toBe(true);
      expect(canTransitionContent('QC_FAILED', 'GENERATING')).toBe(true);
    });
    it('BLOCKED 는 복구 불가 종료 상태다', () => {
      expect(canTransitionContent('QC', 'BLOCKED')).toBe(true);
      expect(canTransitionContent('BLOCKED', 'GENERATING')).toBe(false);
      expect(isContentTerminal('BLOCKED')).toBe(true);
    });
    it('게시된 콘텐츠는 되돌릴 수 없다', () => {
      expect(canTransitionContent('PUBLISHED', 'GENERATING')).toBe(false);
    });
  });

  describe('Task', () => {
    it('명세의 전이를 허용한다', () => {
      expect(canTransitionTask('QUEUED', 'RUNNING')).toBe(true);
      expect(canTransitionTask('RUNNING', 'RETRY')).toBe(true);
      expect(canTransitionTask('RUNNING', 'FALLBACK')).toBe(true);
      expect(canTransitionTask('RETRY', 'RUNNING')).toBe(true);
      expect(canTransitionTask('FALLBACK', 'RUNNING')).toBe(true);
      expect(canTransitionTask('RUNNING', 'ESCALATED')).toBe(true);
      expect(canTransitionTask('RUNNING', 'DONE')).toBe(true);
    });
    it('완료된 Task 는 다시 실행되지 않는다', () => {
      expect(canTransitionTask('DONE', 'RUNNING')).toBe(false);
    });
    it('에스컬레이션된 Task 는 수동 재시도할 수 있다', () => {
      expect(canTransitionTask('ESCALATED', 'RUNNING')).toBe(true);
    });
  });

  describe('진행률 5단계 (§7.2)', () => {
    it('모든 콘텐츠 상태가 5단계 중 하나로 매핑된다', () => {
      const statuses = ['PENDING', 'GENERATING', 'RENDERING', 'QC', 'QC_FAILED',
        'READY', 'APPROVED', 'REJECTED', 'PUBLISHING', 'PUBLISHED', 'BLOCKED', 'FAILED'] as const;
      for (const s of statuses) {
        expect(ORDER_STAGES).toContain(contentStage(s));
      }
    });
  });
});
