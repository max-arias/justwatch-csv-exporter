<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { buildLetterboxdCsv, buildTraktCsv, hasExternalId } from '../../src/lib/csv';
import { isJustWatchUrl, JUSTWATCH_HOME } from '../../src/lib/justwatch-url';
import { activeList, scanStates, type ScanState } from '../../src/lib/scan-state';
import { sendMessage } from '../../src/messaging';
import type { ListKind, ListTitle } from '../../src/types';

const LABELS: Record<ListKind, string> = { seen: 'Seen list', watchlist: 'Watchlist' };
const KINDS = ['seen', 'watchlist'] as const;

const activeKind = ref<ListKind>('seen');
const scans = ref<Record<ListKind, ScanState | null>>({ seen: null, watchlist: null });
const selections = ref<Record<ListKind, Set<string>>>({ seen: new Set(), watchlist: new Set() });
const hasReadState = ref(false);
/** The popup only works on JustWatch; elsewhere a click opens JustWatch instead. */
const isOnJustWatch = ref(false);
const requestError = ref('');
const isExportListOpen = ref(false);
let unwatchers: Array<() => void> = [];

const scan = computed(() => scans.value[activeKind.value]);
const selectedIds = computed(() => selections.value[activeKind.value]);
const isLoading = computed(() => !hasReadState.value || scan.value?.status === 'loading');
const otherLoading = computed(() =>
  KINDS.find((kind) => kind !== activeKind.value && scans.value[kind]?.status === 'loading'),
);
const list = computed(() => (scan.value?.status === 'complete' ? scan.value.list : undefined));
const loadError = computed(() => (scan.value?.status === 'error' ? scan.value.error : requestError.value));
const loadedAt = computed(() =>
  scan.value?.status === 'complete' ? new Date(scan.value.finishedAt).toLocaleString() : undefined,
);
const loadLabel = computed(() => {
  const label = LABELS[activeKind.value];
  const state = scan.value;
  if (!isLoading.value) return `${list.value ? 'Reload' : 'Load'} ${label}`;
  if (state?.status !== 'loading' || !state.total) return `Loading ${label}...`;
  return `Loading ${label}... ${Math.min(state.loaded ?? 0, state.total)}/${state.total}`;
});
const titles = computed(() => list.value?.titles ?? []);
const selectedTitles = computed(() => titles.value.filter((title) => selectedIds.value.has(title.id)));
const selectedMovies = computed(() => selectedTitles.value.filter((title) => title.type === 'movie').length);
const selectedSeries = computed(() => selectedTitles.value.filter((title) => title.type === 'show').length);
const selectedTraktRows = computed(() => selectedTitles.value.filter(hasExternalId).length);

function applyScan(kind: ListKind, state: ScanState | null) {
  const previous = scans.value[kind];
  const isNewList = state?.status === 'complete'
    && !(previous?.status === 'complete' && previous.finishedAt === state.finishedAt);
  scans.value[kind] = state;
  if (state?.status === 'complete' && isNewList) {
    selections.value[kind] = new Set(state.list.titles.map((title) => title.id));
  }
}

function selectTab(kind: ListKind) {
  activeKind.value = kind;
  requestError.value = '';
  void activeList.setValue(kind);
}

async function loadList() {
  requestError.value = '';
  try {
    await sendMessage('loadList', activeKind.value);
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  }
}

async function exportCsv(service: string, csv: string) {
  requestError.value = '';
  const filename = `justwatch-${activeKind.value}-${service}-${new Date().toISOString().slice(0, 10)}.csv`;
  try {
    await sendMessage('saveCsv', { filename, csv });
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not save the CSV file. Please try again.';
  }
}

function setSelection(titlesToSelect: ListTitle[]) {
  selections.value[activeKind.value] = new Set(titlesToSelect.map((title) => title.id));
}

function selectAll() {
  setSelection(titles.value);
}

function selectNone() {
  setSelection([]);
}

function selectByType(type: ListTitle['type']) {
  setSelection(titles.value.filter((title) => title.type === type));
}

function invertSelection() {
  setSelection(titles.value.filter((title) => !selectedIds.value.has(title.id)));
}

function toggleTitle(title: ListTitle) {
  const next = new Set(selectedIds.value);
  if (!next.delete(title.id)) next.add(title.id);
  selections.value[activeKind.value] = next;
}

function titleDetails(title: ListTitle) {
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

  unwatchers = KINDS.map((kind) => scanStates[kind].watch((state) => applyScan(kind, state)));
  await sendMessage('settleScanState').catch(() => {});
  const [seen, watchlist, kind] = await Promise.all([
    scanStates.seen.getValue(),
    scanStates.watchlist.getValue(),
    activeList.getValue(),
  ]);
  applyScan('seen', seen);
  applyScan('watchlist', watchlist);
  activeKind.value = kind;
  hasReadState.value = true;
});

onUnmounted(() => unwatchers.forEach((unwatch) => unwatch()));
</script>

<template>
  <main v-if="isOnJustWatch" class="w-full space-y-3 bg-base-100 p-4 text-base-content" :aria-busy="isLoading">
    <header class="space-y-1">
      <h1 class="text-lg leading-tight font-bold tracking-tight">Export your JustWatch lists</h1>
      <p class="text-sm leading-snug text-base-content/65">
        Pick a list and load it, choose the titles to keep, then download a CSV for Letterboxd or Trakt.
      </p>
    </header>

    <div role="tablist" class="tabs tabs-box tabs-sm w-full" aria-label="JustWatch list">
      <button
        v-for="kind in KINDS"
        :key="kind"
        type="button"
        role="tab"
        class="tab flex-1"
        :class="{ 'tab-active': activeKind === kind }"
        :aria-selected="activeKind === kind"
        @click="selectTab(kind)"
      >
        {{ kind === 'seen' ? 'Seen' : 'Watchlist' }}
      </button>
    </div>

    <button type="button" class="btn btn-primary w-full shadow-none" :disabled="isLoading || Boolean(otherLoading)" @click="loadList">
      <span v-if="isLoading" class="loading loading-spinner loading-sm" aria-hidden="true"></span>
      {{ loadLabel }}
    </button>

    <p v-if="otherLoading" class="text-xs text-base-content/60">Wait for the {{ LABELS[otherLoading] }} to finish loading.</p>

    <p v-if="loadedAt" class="text-xs text-base-content/60">Last loaded {{ loadedAt }}</p>

    <div v-if="loadError" class="alert alert-error alert-soft py-2 text-sm" role="alert">
      {{ loadError }}
    </div>

    <section v-if="list" class="stats w-full overflow-hidden border border-base-300 bg-base-100 shadow-sm" :aria-label="`${LABELS[activeKind]} summary`">
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

    <p v-if="list && list.skipped > 0" class="text-xs text-base-content/60">
      {{ list.skipped }} of {{ list.total }} {{ LABELS[activeKind] }} entries are not movies or series and were skipped.
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

    <div v-else-if="list" class="alert alert-info alert-soft py-2 text-sm">
      Your JustWatch {{ LABELS[activeKind] }} has no movies or series.
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
        <button type="button" class="btn btn-neutral btn-sm justify-between shadow-none" :disabled="selectedTraktRows === 0" @click="exportCsv('trakt', buildTraktCsv(selectedTitles, activeKind))">
          <span>Trakt</span>
          <span class="badge badge-sm">{{ selectedTraktRows }}</span>
        </button>
      </div>

      <p class="text-xs text-base-content/60">
        {{ activeKind === 'seen'
          ? 'Letterboxd and Trakt mark these titles as watched.'
          : 'On Letterboxd, import the file into your watchlist. Trakt adds these titles to your watchlist.' }}
      </p>
    </section>
  </main>
</template>
