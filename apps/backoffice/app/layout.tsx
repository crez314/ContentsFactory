import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CREZ Content Factory',
  description: 'PART 4 개발 명세서 v1.0 백오피스',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
