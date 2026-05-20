import { sendMessage as sendExtensionMessage, type ScanJustWatchListPayload } from '../messaging';
import type { ScanResponse, ScanState } from '../types';

interface BrowserMessagingApi {
  scripting: {
    executeScript(options: any): Promise<unknown>;
  };
}

type SendScanListMessage = (
  type: 'scanJustWatchList' | 'startJustWatchScan',
  data: ScanJustWatchListPayload,
  target: { tabId: number; frameId: number },
) => Promise<ScanResponse | ScanState>;

type SendScanStateMessage = (
  type: 'getJustWatchScanState',
  data: undefined,
  target: { tabId: number; frameId: number },
) => Promise<ScanState>;

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export async function sendScanMessage(
  browserApi: BrowserMessagingApi,
  tabId: number,
  data: ScanJustWatchListPayload,
  sendMessage: SendScanListMessage = sendExtensionMessage,
): Promise<ScanResponse> {
  return sendContentScriptMessage(browserApi, tabId, () =>
    sendMessage('scanJustWatchList', data, targetFor(tabId)),
  ) as Promise<ScanResponse>;
}

export async function startScanMessage(
  browserApi: BrowserMessagingApi,
  tabId: number,
  data: ScanJustWatchListPayload,
  sendMessage: SendScanListMessage = sendExtensionMessage,
): Promise<ScanState> {
  return sendContentScriptMessage(browserApi, tabId, () =>
    sendMessage('startJustWatchScan', data, targetFor(tabId)),
  ) as Promise<ScanState>;
}

export async function getScanStateMessage(
  browserApi: BrowserMessagingApi,
  tabId: number,
  sendMessage: SendScanStateMessage = sendExtensionMessage,
): Promise<ScanState> {
  return sendContentScriptMessage(browserApi, tabId, () =>
    sendMessage('getJustWatchScanState', undefined, targetFor(tabId)),
  ) as Promise<ScanState>;
}

async function sendContentScriptMessage<T>(
  browserApi: BrowserMessagingApi,
  tabId: number,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!isMissingReceivingEndError(error)) {
      throw error;
    }

    await browserApi.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });

    return send();
  }
}

function targetFor(tabId: number) {
  return { tabId, frameId: 0 };
}

export function isMissingReceivingEndError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Could not establish connection. Receiving end does not exist.');
}
