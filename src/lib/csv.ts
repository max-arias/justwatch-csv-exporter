import type { JustWatchItem } from '../types';

export function buildLetterboxdCsv(items: JustWatchItem[]): string {
  const rows = items
    .filter((item) => item.type === 'movie' && item.title && item.year)
    .map((item) => [item.title, item.year ?? '']);

  return toCsv([['Title', 'Year'], ...rows]);
}

export function buildTraktCsv(items: JustWatchItem[]): string {
  const rows = items
    .map((item) => {
      const id = preferredExternalId(item);
      if (!id || item.type === 'unknown') return undefined;
      return [
        id.kind === 'imdb_id' ? id.value : '',
        id.kind === 'tmdb_id' ? id.value : '',
        id.kind === 'tvdb_id' ? id.value : '',
        item.type,
      ];
    })
    .filter((row): row is string[] => Boolean(row));

  return toCsv([['imdb_id', 'tmdb_id', 'tvdb_id', 'type'], ...rows]);
}

export function buildUnresolvedCsv(items: JustWatchItem[]): string {
  const rows = items
    .filter((item) => item.type === 'unknown' || item.externalIds.length === 0)
    .map((item) => [
      item.title,
      item.year ?? '',
      item.type,
      item.url,
      item.unresolvedReason ?? '',
    ]);

  return toCsv([['Title', 'Year', 'Type', 'JustWatch URL', 'Reason'], ...rows]);
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function toCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

function preferredExternalId(item: JustWatchItem) {
  return (
    item.externalIds.find((id) => id.kind === 'imdb_id') ??
    item.externalIds.find((id) => id.kind === 'tmdb_id') ??
    item.externalIds.find((id) => id.kind === 'tvdb_id')
  );
}
