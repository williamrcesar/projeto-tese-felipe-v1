/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  typescript: {
    // ⚠️ Permite build em produção mesmo com erros de tipo
    ignoreBuildErrors: true,
  },
  eslint: {
    // ⚠️ Permite build em produção mesmo com erros de lint
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
