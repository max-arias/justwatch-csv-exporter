import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue', '@wxt-dev/auto-icons'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  zip: {
    excludeSources: ['release-artifacts/**', 'coverage/**', 'VENT.md', 'scripts/**'],
  },
  manifest: ({ browser }) => ({
    name: 'JustWatch CSV Exporter',
    description: 'Export JustWatch list data to Letterboxd and Trakt CSV files.',
    action: {
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
        128: 'icons/128.png',
      },
    },
    // `downloads`: CSV export. `scripting` + host access: read the JustWatch session
    // and call JustWatch's API from a JustWatch tab. `storage`: keep the last result.
    permissions: ['downloads', 'scripting', 'storage'],
    host_permissions: ['https://www.justwatch.com/*'],
    // Promise.withResolvers is the newest platform feature the extension relies on.
    ...(browser === 'firefox' ? {
      browser_specific_settings: {
        gecko: {
          ...(process.env.FIREFOX_EXTENSION_ID ? { id: process.env.FIREFOX_EXTENSION_ID } : {}),
          strict_min_version: '121.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    } : { minimum_chrome_version: '119' }),
  }),
});
