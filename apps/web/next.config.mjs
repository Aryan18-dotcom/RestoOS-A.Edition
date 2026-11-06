/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "https://restro-os-aedition-api.vercel.app/api/v1/:path*"
      }
    ];
  }
};

export default nextConfig;
