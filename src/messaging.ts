import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ScanResponse } from './types';

export interface ScanJustWatchListPayload {
  autoScroll: boolean;
}

interface ProtocolMap {
  scanJustWatchList(data: ScanJustWatchListPayload): ScanResponse;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ProtocolMap>();
