import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue', '@wxt-dev/auto-icons'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
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
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: ['https://www.justwatch.com/*'],
  },
});
