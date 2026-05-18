<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  buildLetterboxdCsv,
  buildTraktCsv,
  buildUnresolvedCsv,
  downloadCsv,
  type JustWatchItem,
  type ScanSummary,
} from '../../src/justwatch';

const items = ref<JustWatchItem[]>([]);
const summary = ref<ScanSummary>({
  scanned: 0,
  letterboxdRows: 0,
  traktRows: 0,
  unresolvedRows: 0,
});
const status = ref('Ready');
const isScanning = ref(false);
const autoScroll = ref(true);

const hasItems = computed(() => items.value.length > 0);
const canExportLetterboxd = computed(() => summary.value.letterboxdRows > 0);
const canExportTrakt = computed(() => summary.value.traktRows > 0);
const canExportUnresolved = computed(() => summary.value.unresolvedRows > 0);

async function scanPage() {
  isScanning.value = true;
  status.value = autoScroll.value ? 'Scanning and loading list items...' : 'Scanning visible list items...';

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.includes('justwatch.com')) {
      throw new Error('Open a JustWatch list page before scanning.');
    }

    const response = await browser.tabs.sendMessage(tab.id, {
      type: 'SCAN_JUSTWATCH_LIST',
      autoScroll: autoScroll.value,
    });

    items.value = response.items;
    summary.value = response.summary;
    status.value = `Scanned ${response.summary.scanned} items`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Scan failed';
  } finally {
    isScanning.value = false;
  }
}

function exportLetterboxd() {
  downloadCsv(timestampedName('letterboxd'), buildLetterboxdCsv(items.value));
}

function exportTrakt() {
  downloadCsv(timestampedName('trakt'), buildTraktCsv(items.value));
}

function exportUnresolved() {
  downloadCsv(timestampedName('unresolved'), buildUnresolvedCsv(items.value));
}

function timestampedName(kind: string) {
  return `justwatch-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}
</script>

<template>
  <main class="popup">
    <header class="header">
      <h1>JustWatch CSV</h1>
      <p>{{ status }}</p>
    </header>

    <label class="toggle">
      <input v-model="autoScroll" type="checkbox" />
      <span>Load full list before scan</span>
    </label>

    <button class="primary" :disabled="isScanning" @click="scanPage">
      {{ isScanning ? 'Scanning...' : 'Scan Page' }}
    </button>

    <section class="stats" aria-label="Scan summary">
      <div>
        <strong>{{ summary.scanned }}</strong>
        <span>Scanned</span>
      </div>
      <div>
        <strong>{{ summary.letterboxdRows }}</strong>
        <span>Letterboxd</span>
      </div>
      <div>
        <strong>{{ summary.traktRows }}</strong>
        <span>Trakt</span>
      </div>
      <div>
        <strong>{{ summary.unresolvedRows }}</strong>
        <span>Unresolved</span>
      </div>
    </section>

    <section class="actions">
      <button :disabled="!canExportLetterboxd" @click="exportLetterboxd">Export Letterboxd</button>
      <button :disabled="!canExportTrakt" @click="exportTrakt">Export Trakt</button>
      <button :disabled="!canExportUnresolved" @click="exportUnresolved">Export Unresolved</button>
    </section>

    <p v-if="hasItems && summary.unresolvedRows" class="note">
      Some rows need manual matching because JustWatch did not expose an external ID.
    </p>
  </main>
</template>
