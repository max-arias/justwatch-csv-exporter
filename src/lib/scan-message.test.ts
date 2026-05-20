import { describe, expect, it, vi } from 'vitest';

vi.mock('@webext-core/messaging', () => ({
  defineExtensionMessaging: () => ({
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));

import {
  getScanStateMessage,
  isMissingReceivingEndError,
  sendScanMessage,
  startScanMessage,
} from './scan-message';
import type { ScanJustWatchListPayload } from '../messaging';
import type { ScanResponse, ScanState } from '../types';

const request: ScanJustWatchListPayload = { autoScroll: true };
const response: ScanResponse = {
  items: [],
  summary: {
    scanned: 0,
    letterboxdRows: 0,
    traktRows: 0,
    unresolvedRows: 0,
  },
};
const scanningState: ScanState = {
  status: 'scanning',
  items: [],
  summary: response.summary,
};

describe('scan messaging', () => {
  it('sends scan messages to an already injected content script', async () => {
    const browserApi = {
      scripting: { executeScript: vi.fn() },
    };
    const sendMessage = vi.fn().mockResolvedValue(response);

    await expect(sendScanMessage(browserApi, 12, request, sendMessage)).resolves.toBe(response);

    expect(sendMessage).toHaveBeenCalledWith('scanJustWatchList', request, { tabId: 12, frameId: 0 });
    expect(browserApi.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('injects the content script and retries when no receiving end exists', async () => {
    const browserApi = {
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    };
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce(response);

    await expect(sendScanMessage(browserApi, 12, request, sendMessage)).resolves.toBe(response);

    expect(browserApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 12 },
      files: ['content-scripts/content.js'],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith('scanJustWatchList', request, {
      tabId: 12,
      frameId: 0,
    });
  });

  it('does not hide unrelated scan failures', async () => {
    const error = new Error('The message port closed before a response was received.');
    const browserApi = {
      scripting: { executeScript: vi.fn() },
    };
    const sendMessage = vi.fn().mockRejectedValue(error);

    await expect(sendScanMessage(browserApi, 12, request, sendMessage)).rejects.toBe(error);

    expect(browserApi.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('starts a persisted content-script scan without waiting for completion', async () => {
    const browserApi = {
      scripting: { executeScript: vi.fn() },
    };
    const sendMessage = vi.fn().mockResolvedValue(scanningState);

    await expect(startScanMessage(browserApi, 12, request, sendMessage)).resolves.toBe(scanningState);

    expect(sendMessage).toHaveBeenCalledWith('startJustWatchScan', request, { tabId: 12, frameId: 0 });
  });

  it('reads persisted scan state from the content script', async () => {
    const browserApi = {
      scripting: { executeScript: vi.fn() },
    };
    const sendMessage = vi.fn().mockResolvedValue(scanningState);

    await expect(getScanStateMessage(browserApi, 12, sendMessage)).resolves.toBe(scanningState);

    expect(sendMessage).toHaveBeenCalledWith('getJustWatchScanState', undefined, { tabId: 12, frameId: 0 });
  });

  it('detects missing receiving end errors', () => {
    expect(
      isMissingReceivingEndError(
        new Error('Could not establish connection. Receiving end does not exist.'),
      ),
    ).toBe(true);
    expect(isMissingReceivingEndError(new Error('No tab with id: 12.'))).toBe(false);
  });
});
