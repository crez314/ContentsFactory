/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 백오피스는 API 서버를 통해서만 데이터에 접근한다. DB 에 직접 붙지 않는다.
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000/v1',
  },
};
export default nextConfig;
