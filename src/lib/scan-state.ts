import { storage } from 'wxt/utils/storage';
import type { SeenList } from '../types';

/** Outcome of the most recent Seen-list load, kept for the browser session. */
export type ScanState =
  | { status: 'loading'; startedAt: string; loaded?: number; total?: number }
  | { status: 'complete'; list: SeenList; finishedAt: string }
  | { status: 'error'; error: string; finishedAt: string };

export const lastScan = storage.defineItem<ScanState>('session:lastScan');
