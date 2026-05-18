import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'JustWatch CSV Exporter',
    description: 'Export JustWatch list data to Letterboxd and Trakt CSV files.',
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: ['https://www.justwatch.com/*'],
  },
});
