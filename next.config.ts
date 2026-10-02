import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The app reads the disease list at runtime; include it in every server trace.
  outputFileTracingIncludes: {
    '/*': ['./scripts/diseases.json'],
  },
};

export default nextConfig;
