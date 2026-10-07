import type { browser } from 'wxt/browser';

/** Revoke blob URLs eventually even if the download never reports completion. */
const BLOB_URL_LIFETIME_MS = 5 * 60_000;

/**
 * Saves a CSV through the downloads API from the background, so closing the
 * popup (e.g. when a "Save as" dialog takes focus) cannot cancel it.
 * Background pages (Firefox) use a blob URL; service workers (Chrome) have no
 * `URL.createObjectURL`, so they use a data URL.
 */
export async function saveCsv(downloads: typeof browser.downloads, filename: string, csv: string): Promise<void> {
  const canUseBlob = typeof URL.createObjectURL === 'function';
  const url = canUseBlob
    ? URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    : `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  try {
    const downloadId = await downloads.download({ url, filename, conflictAction: 'uniquify' });
    if (canUseBlob) revokeWhenDone(downloads, downloadId, url);
  } catch (error) {
    if (canUseBlob) URL.revokeObjectURL(url);
    throw new Error('Could not save the CSV file. Please try again.', { cause: error });
  }
}

function revokeWhenDone(downloads: typeof browser.downloads, downloadId: number, url: string) {
  const revoke = () => {
    clearTimeout(timer);
    downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
  };
  const onChanged = (delta: { id: number; state?: { current?: string } }) => {
    if (delta.id === downloadId && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) revoke();
  };
  const timer = setTimeout(revoke, BLOB_URL_LIFETIME_MS);
  downloads.onChanged.addListener(onChanged);
}
