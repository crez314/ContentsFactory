'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

const DEMO: Array<[string, string]> = [
  ['operator@crez.local', 'OPERATOR'],
  ['reviewer@crez.local', 'REVIEWER'],
  ['admin@crez.local', 'ADMIN'],
  ['root@crez.local', 'SUPER_ROOT'],
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('operator@crez.local');
  const [password, setPassword] = useState('crez1234!');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1 style={{ marginBottom: 4 }}>CREZ Content Factory</h1>
        <div className="sub" style={{ marginBottom: 16 }}>백오피스 로그인</div>
        <ErrorBox error={error} />
        <div className="field">
          <label>이메일</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label>비밀번호</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? '확인 중…' : '로그인'}
        </button>

        <h3 style={{ marginTop: 18 }}>로컬 데모 계정 (비밀번호 crez1234!)</h3>
        <table>
          <tbody>
            {DEMO.map(([mail, role]) => (
              <tr key={mail} style={{ cursor: 'pointer' }} onClick={() => setEmail(mail)}>
                <td className="mono">{mail}</td>
                <td><span className="badge">{role}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>
    </div>
  );
}
