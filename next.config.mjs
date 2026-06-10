/** @type {import('next').NextConfig} */
const INSFORGE_FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL ??
  process.env.INSFORGE_FUNCTIONS_URL ??
  '';

const nextConfig = {
  transpilePackages: [],
  turbopack: {},
  async rewrites() {
    if (!INSFORGE_FUNCTIONS_URL) return [];
    return [
      {
        source: '/functions/v1/:path*',
        destination: `${INSFORGE_FUNCTIONS_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
