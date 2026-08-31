const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development' || process.env.DISABLE_PWA === 'true',
  // Evita que el manifiesto de build de Next quede cacheado por el SW
  // (causa típica de "la PWA no funciona bien" tras cada despliegue).
  buildExcludes: [/middleware-manifest\.json$/, /app-build-manifest\.json$/],
  runtimeCaching: [
    {
      // Las rutas de API son siempre datos en vivo (stock, cajas, ventas...):
      // nunca deben servirse desde caché.
      urlPattern: /^\/api\/.*/i,
      handler: 'NetworkOnly',
    },
    {
      // JS/CSS de Next: se sirven de caché para velocidad, pero se revalidan
      // en segundo plano para no quedarse con una versión vieja tras un deploy.
      urlPattern: /\/_next\/static\/.*/i,
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'next-static' },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      // Todo lo demás (páginas HTML): red primero, con caché de reserva solo
      // para cuando no haya conexión, y con timeout corto para no bloquear.
      urlPattern: /.*/i,
      handler: 'NetworkFirst',
      options: { cacheName: 'pages', networkTimeoutSeconds: 10 },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

module.exports = withPWA(nextConfig);
