import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // A live build without the real Firebase key locks everyone out, so refuse to build it.
  const env = { ...loadEnv(mode, process.cwd()), ...process.env };
  if (mode === 'production' && env.VITE_USE_EMULATORS !== 'true' && !/^AIza[\w-]{35}$/.test(env.VITE_FIREBASE_API_KEY ?? '')) {
    throw new Error('The Firebase settings are missing or damaged. Run: sed -n \'/^VITE_/p\' scripts/first-deploy.sh > .env.production.local');
  }
  return {
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely, so a phone keeps them cached when the app itself is updated.
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router') || id.includes('node_modules/scheduler')) return 'react';
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo-mark.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Insight-IQ',
        short_name: 'Insight-IQ',
        description: 'People, attendance, giving and follow-up for Freedom Church.',
        theme_color: '#14284b',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is cached so the app opens with no internet.
        // Data offline is handled by Firestore's own on-device cache, not the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
};
});
