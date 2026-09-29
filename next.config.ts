import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Route handlers read recorded packs, replays and config from disk; include them in every server trace.
  outputFileTracingIncludes: {
    '/*': ['./fixtures/**/*', './data/**/*'],
  },
};

export default nextConfig;
