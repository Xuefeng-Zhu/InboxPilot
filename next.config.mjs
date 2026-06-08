/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/insforge/functions/**',
          '**/.git/**',
          '**/.next/**',
        ],
        // Wait 2s after last change before recompiling — prevents partial rebuilds
        // when multiple files are written simultaneously (e.g., by AI tools)
        aggregateTimeout: 2000,
        poll: false,
      };
    }
    return config;
  },
};

export default nextConfig;
