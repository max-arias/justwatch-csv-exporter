import { defineExtensionMessaging } from '@webext-core/messaging';

interface ProtocolMap {
  /** Resolves when the load finishes; the outcome is stored in `lastScan`. */
  loadSeenList(): void;
  /** Marks a `loading` state with no load behind it (worker restarted) as interrupted. */
  settleScanState(): void;
  /** Saves a CSV file through the downloads API. */
  saveCsv(data: { filename: string; csv: string }): void;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ProtocolMap>();
