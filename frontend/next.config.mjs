// Compose and the frontend image set INVENTORYMGR_API_URL. On the host,
// localhost reaches the backend without relying on a container DNS name.
const apiUrl = process.env.INVENTORYMGR_API_URL ?? 'http://127.0.0.1:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    proxyClientMaxBodySize: '2gb',
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
