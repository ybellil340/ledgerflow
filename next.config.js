/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async redirects() {
    return [{ source: '/', destination: '/dashboard', permanent: false }]
  },
}
module.exports = nextConfig
