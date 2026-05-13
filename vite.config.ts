import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project pages serve under /<repo>/. The deploy workflow sets
// BASE_URL=/<repo>/ from the repo name automatically. Default './' makes the
// built dist/ folder portable to any host without rebuilding.
const base = process.env.BASE_URL || './';

const pwaDisabled = process.env.ENABLE_PWA === '0';

const buildStamp = new Date().toISOString();

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      disable: pwaDisabled,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-180.png'],
      manifest: {
        name: 'FuelTracker',
        short_name: 'FuelTracker',
        description: 'Offline-first fuel and electricity logbook for multiple vehicles.',
        theme_color: '#0f0e0c',
        background_color: '#0f0e0c',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: base + 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    // Build-time HTML transform: remove the entry <script type="module"> tag
    // Vite emits, and replace it with `window.__FT_ENTRY__ = {src, crossorigin}`
    // at the start of <head>. The inline cleanup script in index.html reads
    // that and only loads the module after Promise.all([unregister-SWs,
    // delete-caches]) resolves — eliminating the race where a stale service
    // worker intercepts the entry fetch and serves the wrong content (which
    // iOS Safari masks as the unhelpful "Script error").
    //
    // Also substitutes __FT_BUILD_STAMP_PLACEHOLDER__ in index.html with the
    // current ISO timestamp.
    {
      name: 'fueltracker:emit-entry-url',
      enforce: 'post' as const,
      transformIndexHtml: {
        order: 'post' as const,
        handler(html: string) {
          let out = html.replace('__FT_BUILD_STAMP_PLACEHOLDER__', buildStamp);
          const m = out.match(
            /<script\b[^>]*?\stype="module"[^>]*?\ssrc="([^"]+)"[^>]*?><\/script>\n?/,
          );
          if (!m) return out;
          const src = m[1];
          const crossorigin = /\bcrossorigin\b/.test(m[0]);
          out = out.replace(m[0], '');
          out = out.replace(
            /<head>/,
            `<head>\n    <script>window.__FT_ENTRY__ = ${JSON.stringify({
              src,
              crossorigin,
            })};</script>\n`,
          );
          return out;
        },
      },
    },
  ],
  build: {
    // Emit .js.map files so the deployed bundle is debuggable from
    // Safari → Mac Web Inspector. The map is fetched only when DevTools
    // is open, so it doesn't bloat what end-users actually download.
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
