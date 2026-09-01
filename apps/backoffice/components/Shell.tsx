'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { logout, tokens, type AuthUser } from '@/lib/api';

/** §7.1 정보 구조 */
const NAV: Array<{ group: string; items: Array<{ href: string; label: string }> }> = [
  { group: '', items: [{ href: '/', label: '대시보드' }] },
  { group: '오더', items: [
    { href: '/orders', label: '오더 목록' },
    { href: '/orders/new', label: '오더 생성' },
  ]},
  { group: '콘텐츠', items: [
    { href: '/contents/approval-queue', label: '승인 대기열' },
    { href: '/contents', label: '콘텐츠 목록' },
  ]},
  { group: '자산', items: [
    { href: '/assets', label: '자산 목록 · 업로드' },
    { href: '/assets/tagging', label: '태깅 검토 대기열' },
    { href: '/assets/licenses', label: '라이선스 관리' },
    { href: '/assets/coverage', label: '커버리지' },
    { href: '/assets/gaps', label: '커버리지 부족' },
  ]},
  { group: '운영', items: [
    { href: '/ops/tasks', label: 'Task 모니터' },
    { href: '/ops/escalations', label: '실패 · 에스컬레이션' },
    { href: '/ops/costs', label: '비용' },
    { href: '/ops/channel-health', label: '채널 안전 게시' },
    { href: '/ops/metrics', label: '운영 지표' },
  ]},
  { group: '설정', items: [
    { href: '/settings/agents', label: '에이전트' },
    { href: '/settings/channels', label: '채널' },
    { href: '/settings/users', label: '사용자 · 권한' },
    { href: '/settings/master', label: '마스터' },
  ]},
];

export function Shell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const u = tokens.user;
    if (!u) router.replace('/login');
    else setUser(u);
  }, [router]);

  if (!user) return null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          CREZ Content Factory
          <small>V1 · Order → Publish</small>
        </div>
        {NAV.map((g) => (
          <div className="navgroup" key={g.group || 'root'}>
            {g.group && <span>{g.group}</span>}
            <nav className="nav">
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className={pathname === it.href ? 'active' : ''}
                >
                  {it.label}
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <div className="row">
            {actions}
            <span className="badge info">{user.name} · {user.role}</span>
            <button onClick={() => void logout().then(() => router.replace('/login'))}>로그아웃</button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
