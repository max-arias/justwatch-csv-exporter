import { storage, type WxtStorageItem } from 'wxt/utils/storage';
import type { ListKind, TitleList } from '../types';

/** Outcome of the most recent load of one list, kept for the browser session. */
export type ScanState =
  | { status: 'loading'; startedAt: string; loaded?: number; total?: number }
  | { status: 'complete'; list: TitleList; finishedAt: string }
  | { status: 'error'; error: string; finishedAt: string };

export const scanStates: Record<ListKind, WxtStorageItem<ScanState | null, {}>> = {
  seen: storage.defineItem<ScanState>('session:scan:seen'),
  watchlist: storage.defineItem<ScanState>('session:scan:watchlist'),
};

/** Popup tab shown on open; remembered because a Save-as dialog closes the popup. */
export const activeList = storage.defineItem<ListKind>('session:activeList', { fallback: 'seen' });
