/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Salida standalone: la imagen de producción solo lleva el runtime mínimo, sin el
  // node_modules completo.
  output: 'standalone',
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self), microphone=(), camera=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
