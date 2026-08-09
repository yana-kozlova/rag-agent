// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'img.daisyui.com' },
      // Uploaded images. The store id prefixes the hostname, so it is wildcarded.
      { protocol: 'https', hostname: '**.public.blob.vercel-storage.com' },
    ],
  },
  // Target modern browsers only (no legacy JS)
  compiler: {
    // `info` is kept alongside `error`/`warn` because it is what survives into
    // production on purpose. `lib/ai/telemetry.ts` is the single place every
    // paid OpenAI call is recorded, and it wrote through `console.log` — which
    // this transform strips, so the one ledger of what the app spends existed
    // in development and nowhere else. Chatty per-request diagnostics stay on
    // `console.log` and stay stripped; anything that must be readable in a
    // deployed log uses `console.info` and says so.
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn', 'info'],
    } : false,
  },
  experimental: {
    optimizePackageImports: [
      '@ai-sdk/react',
      '@ai-sdk/openai',
      'daisyui',
      'lucide-react',
      'date-fns',
    ],
  },
  // Webpack optimizations
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Exclude server-only modules from client bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
      
      // Split large chunks
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Split vendor chunks
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Separate large libraries
            googleapis: {
              name: 'googleapis',
              test: /[\\/]node_modules[\\/](googleapis|@google-cloud)[\\/]/,
              chunks: 'all',
              priority: 30,
            },
            ai: {
              name: 'ai',
              test: /[\\/]node_modules[\\/](@ai-sdk|ai)[\\/]/,
              chunks: 'all',
              priority: 30,
            },
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
            },
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;