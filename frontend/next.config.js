/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Same-origin API proxy: the browser talks to the Next.js server, which
  // forwards /api/v1/* to the backend. Keeps deployments free of CORS and
  // works behind authenticated port-forwarding tunnels (e.g. Codespaces),
  // where a cross-origin API URL would not carry the tunnel cookie.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://localhost:8000/api/v1/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
