<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  buildLetterboxdCsv,
  buildTraktCsv,
  downloadCsv,
  type JustWatchItem,
  type ScanSummary,
} from '../../src/justwatch';
import { sendScanMessage } from '../../src/lib/scan-message';

const items = ref<JustWatchItem[]>([]);
const summary = ref<ScanSummary>({
  scanned: 0,
  letterboxdRows: 0,
  traktRows: 0,
  unresolvedRows: 0,
});
const scanError = ref('');
const hasScanned = ref(false);
const isScanning = ref(false);
const isExportListOpen = ref(false);
const selectedItemKeys = ref(new Set<string>());

const exportableItems = computed(() => items.value.filter(isExportable));
const selectedItems = computed(() => exportableItems.value.filter((item) => selectedItemKeys.value.has(itemKey(item))));
const filteredLetterboxdRows = computed(() => selectedItems.value.filter((item) => item.type === 'movie').length);
const filteredTraktRows = computed(() => selectedItems.value.length);
const selectedMovies = computed(() => selectedItems.value.filter((item) => item.type === 'movie').length);
const selectedSeries = computed(() => selectedItems.value.filter((item) => item.type === 'show').length);
const canExportLetterboxd = computed(() => filteredLetterboxdRows.value > 0);
const canExportTrakt = computed(() => filteredTraktRows.value > 0);

async function scanPage() {
  isScanning.value = true;
  scanError.value = '';

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.includes('justwatch.com')) {
      throw new Error('Open a JustWatch list page before scanning.');
    }

    const response = await sendScanMessage(browser, tab.id, {
      autoScroll: true,
    });

    items.value = response.items;
    summary.value = response.summary;
    selectAll();
    hasScanned.value = true;
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Scan failed';
  } finally {
    isScanning.value = false;
  }
}

function exportLetterboxd() {
  downloadCsv(timestampedName('letterboxd'), buildLetterboxdCsv(selectedItems.value));
}

function exportTrakt() {
  downloadCsv(timestampedName('trakt'), buildTraktCsv(selectedItems.value));
}

function selectAll() {
  selectedItemKeys.value = new Set(exportableItems.value.map(itemKey));
}

function selectNone() {
  selectedItemKeys.value = new Set();
}

function selectMovies() {
  selectByType('movie');
}

function selectSeries() {
  selectByType('show');
}

function selectByType(type: JustWatchItem['type']) {
  selectedItemKeys.value = new Set(exportableItems.value.filter((item) => item.type === type).map(itemKey));
}

function invertSelection() {
  selectedItemKeys.value = new Set(
    exportableItems.value
      .filter((item) => !selectedItemKeys.value.has(itemKey(item)))
      .map(itemKey),
  );
}

function toggleItem(item: JustWatchItem) {
  const next = new Set(selectedItemKeys.value);
  const key = itemKey(item);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  selectedItemKeys.value = next;
}

function isSelected(item: JustWatchItem) {
  return selectedItemKeys.value.has(itemKey(item));
}

function itemKey(item: JustWatchItem) {
  return item.url;
}

function isExportable(item: JustWatchItem) {
  return (item.type === 'movie' || item.type === 'show') && Boolean(item.title && item.year);
}

function itemTypeLabel(item: JustWatchItem) {
  return item.type === 'show' ? 'Series' : 'Movie';
}

function timestampedName(kind: string) {
  return `justwatch-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}
</script>

<template>
  <main class="popup">
    <header class="header">
      <h1>JustWatch CSV</h1>
    </header>

    <button class="primary" :disabled="isScanning" @click="scanPage">
      {{ isScanning ? 'Scanning...' : 'Scan Page' }}
    </button>
    <p v-if="scanError" class="error-message">{{ scanError }}</p>

    <section v-if="hasScanned" class="stats" aria-label="Scan summary">
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
    </section>

    <section v-if="hasScanned" class="export-list" aria-label="Export selection">
      <button class="export-list__summary" type="button" @click="isExportListOpen = !isExportListOpen">
        <span aria-hidden="true">{{ isExportListOpen ? '⌄' : '›' }}</span>
        <strong>{{ selectedItems.length }}/{{ exportableItems.length }} items found ready for export</strong>
      </button>

      <div v-if="isExportListOpen" class="export-list__body">
        <div class="bulk-actions" aria-label="Bulk selection controls">
          <button type="button" @click="selectAll">All</button>
          <button type="button" @click="selectNone">None</button>
          <button type="button" @click="selectMovies">Movies</button>
          <button type="button" @click="selectSeries">Series</button>
          <button type="button" @click="invertSelection">Invert</button>
        </div>

        <div class="selection-counts">
          {{ selectedMovies }} movies, {{ selectedSeries }} series selected
        </div>

        <div class="title-list">
          <label v-for="item in exportableItems" :key="itemKey(item)" class="title-row">
            <input type="checkbox" :checked="isSelected(item)" @change="toggleItem(item)" />
            <img v-if="item.posterUrl" :src="item.posterUrl" :alt="`${item.title} poster`" />
            <span v-else class="poster-fallback" aria-hidden="true"></span>
            <span class="title-row__copy">
              <strong>{{ item.title }}</strong>
              <span>{{ item.year }} · {{ itemTypeLabel(item) }}</span>
            </span>
          </label>
        </div>
      </div>
    </section>

    <section v-if="hasScanned" class="actions">
      <button :disabled="!canExportLetterboxd" @click="exportLetterboxd">
        Export Letterboxd <span>{{ filteredLetterboxdRows }}</span>
      </button>
      <button :disabled="!canExportTrakt" @click="exportTrakt">
        Export Trakt <span>{{ filteredTraktRows }}</span>
      </button>
    </section>
  </main>
</template>
