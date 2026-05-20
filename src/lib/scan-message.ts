import { sendMessage as sendExtensionMessage, type ScanJustWatchListPayload } from '../messaging';
import type { ScanResponse } from '../types';

interface BrowserMessagingApi {
  scripting: {
    executeScript(options: any): Promise<unknown>;
  };
}

type SendScanListMessage = (
  type: 'scanJustWatchList',
  data: ScanJustWatchListPayload,
  target: { tabId: number; frameId: number },
) => Promise<ScanResponse>;

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export async function sendScanMessage(
  browserApi: BrowserMessagingApi,
  tabId: number,
  data: ScanJustWatchListPayload,
  sendMessage: SendScanListMessage = sendExtensionMessage,
): Promise<ScanResponse> {
  const target = { tabId, frameId: 0 };

  try {
    return await sendMessage('scanJustWatchList', data, target);
  } catch (error) {
    if (!isMissingReceivingEndError(error)) {
      throw error;
    }

    await browserApi.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });

    return sendMessage('scanJustWatchList', data, target);
  }
}

export function isMissingReceivingEndError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Could not establish connection. Receiving end does not exist.');
}
