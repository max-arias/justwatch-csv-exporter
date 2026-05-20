<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  buildLetterboxdCsv,
  buildTraktCsv,
  downloadCsv,
  type JustWatchItem,
  type ScanSummary,
} from '../../src/justwatch';
import type { ScanState } from '../../src/types';
import { getScanStateMessage, startScanMessage } from '../../src/lib/scan-message';

const POLL_INTERVAL_MS = 750;

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
let pollTimer: number | undefined;

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
  selectedItemKeys.value = new Set();

  try {
    const tabId = await getActiveJustWatchTabId();

    const state = await startScanMessage(browser, tabId, {
      autoScroll: true,
    });

    applyScanState(state);
    startPollingScanState(tabId);
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Scan failed';
    isScanning.value = false;
    stopPollingScanState();
  }
}

async function restoreScanState() {
  try {
    const tabId = await getActiveJustWatchTabId();
    const state = await getScanStateMessage(browser, tabId);
    applyScanState(state);
    if (state.status === 'scanning') {
      startPollingScanState(tabId);
    }
  } catch {
    // Ignore restore failures. The scan button will surface actionable tab errors.
  }
}

function startPollingScanState(tabId: number) {
  stopPollingScanState();
  pollTimer = window.setInterval(async () => {
    try {
      const state = await getScanStateMessage(browser, tabId);
      applyScanState(state);
      if (state.status !== 'scanning') {
        stopPollingScanState();
      }
    } catch (error) {
      scanError.value = error instanceof Error ? error.message : 'Could not refresh scan state';
      isScanning.value = false;
      stopPollingScanState();
    }
  }, POLL_INTERVAL_MS);
}

function stopPollingScanState() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function applyScanState(state: ScanState) {
  isScanning.value = state.status === 'scanning';
  scanError.value = state.status === 'error' ? state.error ?? 'Scan failed' : '';

  if (state.status === 'complete') {
    items.value = state.items;
    summary.value = state.summary;
    hasScanned.value = true;
    if (selectedItemKeys.value.size === 0) {
      selectAll();
    }
  } else if (state.status === 'scanning') {
    items.value = state.items;
    summary.value = state.summary;
    hasScanned.value = false;
  } else if (state.status === 'error') {
    hasScanned.value = false;
  }
}

async function getActiveJustWatchTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab.id || !tab.url?.includes('justwatch.com')) {
    throw new Error('Open a JustWatch list page before scanning.');
  }
  return tab.id;
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

function syncExportListOpen(event: Event) {
  isExportListOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}

function timestampedName(kind: string) {
  return `justwatch-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}

onMounted(() => {
  void restoreScanState();
});

onUnmounted(() => {
  stopPollingScanState();
});
</script>

<template>
  <main class="w-full space-y-3 bg-base-100 p-4 text-base-content" :aria-busy="isScanning">
    <header class="space-y-1">
      <h1 class="text-lg leading-tight font-bold tracking-tight">Seen list exporter</h1>
      <p class="text-sm leading-snug text-base-content/65">
        Scan your JustWatch Seen list, choose what to keep, then export CSVs for Letterboxd or Trakt.
      </p>
    </header>

    <button type="button" class="btn btn-primary w-full shadow-none" :disabled="isScanning" @click="scanPage">
      <span v-if="isScanning" class="loading loading-spinner loading-sm" aria-hidden="true"></span>
      {{ isScanning ? 'Scanning...' : 'Scan Page' }}
    </button>

    <div v-if="scanError" class="alert alert-error alert-soft py-2 text-sm" role="alert">
      {{ scanError }}
    </div>

    <section v-if="hasScanned" class="stats w-full overflow-hidden border border-base-300 bg-base-100 shadow-sm" aria-label="Scan summary">
      <div class="stat place-items-center px-2 py-2.5">
        <div class="stat-value text-base leading-none">{{ summary.scanned }}</div>
        <div class="stat-title text-[0.7rem]">Scanned</div>
      </div>
      <div class="stat place-items-center border-x border-base-300 px-2 py-2.5">
        <div class="stat-value text-base leading-none">{{ summary.letterboxdRows }}</div>
        <div class="stat-title text-[0.7rem]">Letterboxd</div>
      </div>
      <div class="stat place-items-center px-2 py-2.5">
        <div class="stat-value text-base leading-none">{{ summary.traktRows }}</div>
        <div class="stat-title text-[0.7rem]">Trakt</div>
      </div>
    </section>

    <details
      v-if="hasScanned && exportableItems.length > 0"
      class="collapse collapse-arrow border border-base-300 bg-base-100 shadow-md"
      :open="isExportListOpen"
      aria-label="Export selection"
      @toggle="syncExportListOpen"
    >
      <summary class="collapse-title min-h-11 py-3 pr-10 pl-4 text-sm font-bold">
        {{ selectedItems.length }}/{{ exportableItems.length }} items found ready for export
      </summary>

      <div class="collapse-content space-y-3 px-3 pb-3">
        <div class="grid grid-cols-5 gap-1.5" role="group" aria-label="Bulk selection controls">
          <button type="button" class="btn btn-ghost btn-xs" @click="selectAll">All</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="selectNone">None</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="selectMovies">Movies</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="selectSeries">Series</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="invertSelection">Invert</button>
        </div>

        <div class="text-xs text-base-content/60">
          {{ selectedMovies }} movies, {{ selectedSeries }} series selected
        </div>

        <div class="max-h-56 overflow-auto rounded-box border border-base-300 bg-base-200/40">
          <label
            v-for="item in exportableItems"
            :key="itemKey(item)"
            class="grid cursor-pointer grid-cols-[auto_2.125rem_minmax(0,1fr)] items-center gap-2.5 border-b border-base-300 px-2 py-2 last:border-b-0 hover:bg-base-200"
          >
            <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" :checked="isSelected(item)" @change="toggleItem(item)" />
            <span class="avatar">
              <div class="h-[50px] w-[34px] overflow-hidden rounded-lg bg-base-300">
                <img v-if="item.posterUrl" :src="item.posterUrl" alt="" class="h-full w-full object-cover" />
              </div>
            </span>
            <span class="min-w-0 space-y-0.5">
              <strong class="block truncate text-sm leading-tight">{{ item.title }}</strong>
              <span class="block truncate text-xs text-base-content/60">{{ item.year }} · {{ itemTypeLabel(item) }}</span>
            </span>
          </label>
        </div>
      </div>
    </details>

    <div v-else-if="hasScanned" class="alert alert-info alert-soft py-2 text-sm">
      No exportable movies or series with both title and year were found on this page.
    </div>

    <section v-if="hasScanned" class="space-y-1.5">
      <div class="text-xs font-bold tracking-wide text-base-content/60 uppercase">
        Export selected to
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-neutral btn-sm justify-between shadow-none" :disabled="!canExportLetterboxd" @click="exportLetterboxd">
          <span>Letterboxd</span>
          <span class="badge badge-sm">{{ filteredLetterboxdRows }}</span>
        </button>
        <button type="button" class="btn btn-neutral btn-sm justify-between shadow-none" :disabled="!canExportTrakt" @click="exportTrakt">
          <span>Trakt</span>
          <span class="badge badge-sm">{{ filteredTraktRows }}</span>
        </button>
      </div>
    </section>
  </main>
</template>
