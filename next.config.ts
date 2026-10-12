import type { NextConfig } from 'next';
const config: NextConfig = { distDir: process.env.NEXT_BUILD_DIR ?? 'build-output' };
export default config;
