/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Same-origin API proxy: the browser talks to the Next.js server, which
  // forwards /api/v1/* to the backend. Keeps deployments free of CORS and
  // works behind authenticated port-forwarding tunnels (e.g. Codespaces),
  // where a cross-origin API URL would not carry the tunnel cookie.
  // API_PROXY_TARGET points at the backend (Railway private networking in
  // production; localhost in development).
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.trim();
    if (!target) {
      return [];
    }
    return [
      {
        source: "/api/v1/:path*",
        destination: `${target}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
