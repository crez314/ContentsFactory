'use client';

import { useState } from 'react';
import { api, hasMinRole, tokens } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ErrorBox, StatusBadge, relTime, usePolling } from '@/components/ui';

interface User {
  id: string; email: string; name: string; role: string; status: string;
  lastLoginAt: string | null; createdAt: string;
}

const ROLES = ['VIEWER', 'REVIEWER', 'OPERATOR', 'ADMIN', 'SUPER_ROOT'];
const ROLE_DESC: Record<string, string> = {
  SUPER_ROOT: '전체 권한 + Emergency Stop + 감사 로그',
  ADMIN: '에이전트·채널·라이선스·사용자 관리',
  OPERATOR: '자산 업로드·태깅, 오더 생성·제출, Task 재시도',
  REVIEWER: '콘텐츠 승인·반려, 공개 전환',
  VIEWER: '조회만',
};

export default function UsersPage() {
  const me = tokens.user;
  const admin = hasMinRole(me?.role, 'ADMIN');
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'VIEWER' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [stopping, setStopping] = useState(false);

  const { data, error, reload } = usePolling<User[]>(
    () => (admin ? api.get<User[]>('/users').then((r) => r.data) : Promise.resolve([])), 0,
  );

  const create = async () => {
    setBusy(true); setActionError(null);
    try { await api.post('/users', form); setForm({ email: '', name: '', password: '', role: 'VIEWER' }); await reload(); }
    catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  const emergencyStop = async (active: boolean) => {
    setStopping(true); setActionError(null);
    try { await api.post('/system/emergency-stop', { active, reason: '백오피스에서 실행' }); }
    catch (e) { setActionError(e); } finally { setStopping(false); }
  };

  return (
    <Shell title="사용자 · 권한" subtitle="REVIEWER 와 OPERATOR 는 상하 관계가 아니라 성격이 다른 역할입니다. 승인 권한은 별도로 검사됩니다.">
      <ErrorBox error={error} />
      <ErrorBox error={actionError} />

      {!admin ? <div className="card"><div className="empty">사용자 관리는 ADMIN 이상만 볼 수 있습니다.</div></div> : (
        <>
          <div className="card">
            <table>
              <thead><tr><th>이메일</th><th>이름</th><th>역할</th><th>권한</th><th>상태</th><th>마지막 로그인</th></tr></thead>
              <tbody>
                {(data ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.email}</td>
                    <td>{u.name}</td>
                    <td>
                      <select style={{ width: 140 }} value={u.role} disabled={busy}
                        onChange={(e) => void api.patch(`/users/${u.id}`, { role: e.target.value }).then(reload)}>
                        {ROLES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="sub">{ROLE_DESC[u.role]}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="sub">{relTime(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>사용자 추가</h3>
            <div className="grid cols-4">
              <div className="field"><label>이메일</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="field"><label>이름</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label>비밀번호 (8자 이상)</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div className="field"><label>역할</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select></div>
            </div>
            <button className="primary" disabled={busy || !form.email || !form.name || form.password.length < 8}
              onClick={() => void create()}>추가</button>
          </div>
        </>
      )}

      {me?.role === 'SUPER_ROOT' && (
        <div className="card" style={{ marginTop: 12, borderColor: '#6b2d2d' }}>
          <h3 style={{ color: 'var(--danger)' }}>Emergency Stop</h3>
          <p className="sub">
            모든 작업 큐를 일시정지합니다. 이미 실행 중인 Job 은 끝까지 진행되지만 새 Job 은 집히지 않습니다.
          </p>
          <div className="row">
            <button className="danger" disabled={stopping} onClick={() => void emergencyStop(true)}>전체 정지</button>
            <button disabled={stopping} onClick={() => void emergencyStop(false)}>정지 해제</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
