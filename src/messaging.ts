import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ScanResponse, ScanState } from './types';

export interface ScanJustWatchListPayload {
  autoScroll: boolean;
}

interface ProtocolMap {
  scanJustWatchSeenPage(data: ScanJustWatchListPayload & { tabId: number }): ScanState;
  scanJustWatchList(data: ScanJustWatchListPayload): ScanResponse;
  startJustWatchScan(data: ScanJustWatchListPayload): ScanState;
  getJustWatchScanState(): ScanState;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ProtocolMap>();
