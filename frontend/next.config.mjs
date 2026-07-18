// Local default. Every containerised path (docker-compose.yml,
// docker-compose.e2e.yml, frontend/Dockerfile) sets INVENTORYMGR_API_URL
// explicitly, so this fallback only applies to host runs — `bun run dev`,
// `just web-dev`, and Playwright's webServer — where `backend` does not resolve.
const apiUrl = process.env.INVENTORYMGR_API_URL ?? 'http://127.0.0.1:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
