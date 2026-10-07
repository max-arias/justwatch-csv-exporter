<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { buildLetterboxdCsv, buildTraktCsv, hasExternalId } from '../../src/lib/csv';
import { isJustWatchUrl, JUSTWATCH_HOME } from '../../src/lib/justwatch-url';
import { lastScan, type ScanState } from '../../src/lib/scan-state';
import { sendMessage } from '../../src/messaging';
import type { SeenTitle } from '../../src/types';

const scan = ref<ScanState | null>(null);
const hasReadState = ref(false);
/** The popup only works on JustWatch; elsewhere a click opens JustWatch instead. */
const isOnJustWatch = ref(false);
const requestError = ref('');
const isExportListOpen = ref(false);
const selectedIds = ref(new Set<string>());
let unwatch: (() => void) | undefined;

const isLoading = computed(() => !hasReadState.value || scan.value?.status === 'loading');
const seenList = computed(() => (scan.value?.status === 'complete' ? scan.value.list : undefined));
const loadError = computed(() => (scan.value?.status === 'error' ? scan.value.error : requestError.value));
const loadedAt = computed(() =>
  scan.value?.status === 'complete' ? new Date(scan.value.finishedAt).toLocaleString() : undefined,
);
const loadingLabel = computed(() => {
  const state = scan.value;
  if (state?.status !== 'loading' || !state.total) return 'Loading Seen list...';
  return `Loading Seen list... ${Math.min(state.loaded ?? 0, state.total)}/${state.total}`;
});
const titles = computed(() => seenList.value?.titles ?? []);
const selectedTitles = computed(() => titles.value.filter((title) => selectedIds.value.has(title.id)));
const selectedMovies = computed(() => selectedTitles.value.filter((title) => title.type === 'movie').length);
const selectedSeries = computed(() => selectedTitles.value.filter((title) => title.type === 'show').length);
const selectedTraktRows = computed(() => selectedTitles.value.filter(hasExternalId).length);

function applyScan(state: ScanState | null) {
  const isNewList = state?.status === 'complete'
    && !(scan.value?.status === 'complete' && scan.value.finishedAt === state.finishedAt);
  scan.value = state;
  if (isNewList) selectAll();
}

async function loadList() {
  requestError.value = '';
  try {
    await sendMessage('loadSeenList');
  } catch {
    requestError.value = 'Something went wrong. Please try again.';
  }
}

async function exportCsv(kind: string, csv: string) {
  requestError.value = '';
  try {
    await sendMessage('saveCsv', { filename: `justwatch-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv });
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not save the CSV file. Please try again.';
  }
}

function selectAll() {
  selectedIds.value = new Set(titles.value.map((title) => title.id));
}

function selectNone() {
  selectedIds.value = new Set();
}

function selectByType(type: SeenTitle['type']) {
  selectedIds.value = new Set(titles.value.filter((title) => title.type === type).map((title) => title.id));
}

function invertSelection() {
  selectedIds.value = new Set(titles.value.filter((title) => !selectedIds.value.has(title.id)).map((title) => title.id));
}

function toggleTitle(title: SeenTitle) {
  const next = new Set(selectedIds.value);
  if (!next.delete(title.id)) next.add(title.id);
  selectedIds.value = next;
}

function titleDetails(title: SeenTitle) {
  const parts = [title.year?.toString() ?? 'Unknown year', title.type === 'show' ? 'Series' : 'Movie'];
  if (title.type === 'show' && title.showProgress !== undefined && title.showProgress < 100) {
    parts.push(`${Math.round(title.showProgress)}% seen`);
  }
  if (!hasExternalId(title)) parts.push('no IMDb/TMDB ID');
  return parts.join(' · ');
}

function syncExportListOpen(event: Event) {
  isExportListOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}

onMounted(async () => {
  // Host access to www.justwatch.com is what exposes the tab URL, so any other
  // site (whose URL is hidden) is "not JustWatch".
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!isJustWatchUrl(tab?.url)) {
    await browser.tabs.create({ url: JUSTWATCH_HOME });
    window.close();
    return;
  }
  isOnJustWatch.value = true;

  unwatch = lastScan.watch(applyScan);
  await sendMessage('settleScanState').catch(() => {});
  const state = await lastScan.getValue();
  applyScan(state);
  hasReadState.value = true;
  // Show the last result when there is one; load automatically only on first use.
  if (!state) void loadList();
});

onUnmounted(() => unwatch?.());
</script>

<template>
  <main v-if="isOnJustWatch" class="w-full space-y-3 bg-base-100 p-4 text-base-content" :aria-busy="isLoading">
    <header class="space-y-1">
      <h1 class="text-lg leading-tight font-bold tracking-tight">Export your Seen list</h1>
      <p class="text-sm leading-snug text-base-content/65">
        Choose the titles to keep, then download a CSV for Letterboxd or Trakt.
      </p>
    </header>

    <button type="button" class="btn btn-primary w-full shadow-none" :disabled="isLoading" @click="loadList">
      <span v-if="isLoading" class="loading loading-spinner loading-sm" aria-hidden="true"></span>
      {{ isLoading ? loadingLabel : 'Reload' }}
    </button>

    <p v-if="loadedAt" class="text-xs text-base-content/60">Last loaded {{ loadedAt }}</p>

    <div v-if="loadError" class="alert alert-error alert-soft py-2 text-sm" role="alert">
      {{ loadError }}
    </div>

    <section v-if="seenList" class="stats w-full overflow-hidden border border-base-300 bg-base-100 shadow-sm" aria-label="Seen list summary">
      <div class="stat place-items-center px-2 py-2.5">
        <div class="stat-value text-base leading-none">{{ titles.length }}</div>
        <div class="stat-title text-[0.7rem]">Titles</div>
      </div>
      <div class="stat place-items-center border-x border-base-300 px-2 py-2.5">
        <div class="stat-value text-base leading-none">{{ titles.filter((title) => title.type === 'movie').length }}</div>
        <div class="stat-title text-[0.7rem]">Movies</div>
      </div>
      <div class="stat place-items-center px-2 py-2.5">
        <div class="stat-value text-base leading-none">{{ titles.filter((title) => title.type === 'show').length }}</div>
        <div class="stat-title text-[0.7rem]">Series</div>
      </div>
    </section>

    <p v-if="seenList && seenList.skipped > 0" class="text-xs text-base-content/60">
      {{ seenList.skipped }} of {{ seenList.total }} Seen entries are not movies or series and were skipped.
    </p>

    <details
      v-if="titles.length > 0"
      class="collapse collapse-arrow border border-base-300 bg-base-100 shadow-md"
      :open="isExportListOpen"
      aria-label="Export selection"
      @toggle="syncExportListOpen"
    >
      <summary class="collapse-title min-h-11 py-3 pr-10 pl-4 text-sm font-bold">
        {{ selectedTitles.length }}/{{ titles.length }} titles selected for export
      </summary>

      <div class="collapse-content space-y-3 px-3 pb-3">
        <div class="grid grid-cols-5 gap-1.5" role="group" aria-label="Bulk selection controls">
          <button type="button" class="btn btn-ghost btn-xs" @click="selectAll">All</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="selectNone">None</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="selectByType('movie')">Movies</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="selectByType('show')">Series</button>
          <button type="button" class="btn btn-ghost btn-xs" @click="invertSelection">Invert</button>
        </div>

        <div class="text-xs text-base-content/60">
          {{ selectedMovies }} movies, {{ selectedSeries }} series selected
        </div>

        <div class="max-h-56 overflow-auto rounded-box border border-base-300 bg-base-200/40">
          <label
            v-for="title in titles"
            :key="title.id"
            class="grid cursor-pointer grid-cols-[auto_2.125rem_minmax(0,1fr)] items-center gap-2.5 border-b border-base-300 px-2 py-2 last:border-b-0 hover:bg-base-200"
          >
            <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" :checked="selectedIds.has(title.id)" @change="toggleTitle(title)" />
            <span class="avatar">
              <div class="h-[50px] w-[34px] overflow-hidden rounded-lg bg-base-300">
                <img v-if="title.posterUrl" :src="title.posterUrl" alt="" class="h-full w-full object-cover" />
              </div>
            </span>
            <span class="min-w-0 space-y-0.5">
              <strong class="block truncate text-sm leading-tight">{{ title.title }}</strong>
              <span class="block truncate text-xs text-base-content/60">{{ titleDetails(title) }}</span>
            </span>
          </label>
        </div>
      </div>
    </details>

    <div v-else-if="seenList" class="alert alert-info alert-soft py-2 text-sm">
      Your JustWatch Seen list has no movies or series.
    </div>

    <section v-if="titles.length > 0" class="space-y-1.5">
      <div class="text-xs font-bold tracking-wide text-base-content/60 uppercase">
        Export selected to
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-neutral btn-sm justify-between shadow-none" :disabled="selectedMovies === 0" @click="exportCsv('letterboxd', buildLetterboxdCsv(selectedTitles))">
          <span>Letterboxd</span>
          <span class="badge badge-sm">{{ selectedMovies }}</span>
        </button>
        <button type="button" class="btn btn-neutral btn-sm justify-between shadow-none" :disabled="selectedTraktRows === 0" @click="exportCsv('trakt', buildTraktCsv(selectedTitles))">
          <span>Trakt</span>
          <span class="badge badge-sm">{{ selectedTraktRows }}</span>
        </button>
      </div>
    </section>
  </main>
</template>
