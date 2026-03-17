import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@justice/shared-types'],
};

export default nextConfig;
