import type { ListKind, ListTitle } from '../types';

/**
 * Letterboxd import format: movies only. The same file imports as watched films
 * or into the Letterboxd watchlist. IMDb/TMDB IDs take precedence over
 * title matching. No WatchedDate: JustWatch only knows when a title was marked,
 * which would create misleading diary entries.
 */
export function buildLetterboxdCsv(titles: ListTitle[]): string {
  const rows = titles
    .filter((title) => title.type === 'movie')
    .map((title) => [neutralizeFormula(title.title), title.year?.toString() ?? '', title.imdbId ?? '', title.tmdbId ?? '']);
  return toCsv([['Title', 'Year', 'imdbID', 'tmdbID'], ...rows]);
}

/**
 * Trakt import format: an external ID is required, so titles without one are
 * omitted. Seen rows use `watched_at` (`unknown` when JustWatch has no date);
 * watchlist rows use `watchlisted_at`, falling back to the export time.
 */
export function buildTraktCsv(titles: ListTitle[], kind: ListKind, exportedAt = new Date().toISOString()): string {
  const [dateColumn, missingDate] = kind === 'seen' ? ['watched_at', 'unknown'] : ['watchlisted_at', exportedAt];
  const rows = titles
    .filter(hasExternalId)
    .map((title) => [title.imdbId ?? '', title.tmdbId ?? '', title.type, title.addedAt ?? missingDate]);
  return toCsv([['imdb_id', 'tmdb_id', 'type', dateColumn], ...rows]);
}

export function hasExternalId(title: ListTitle): boolean {
  return Boolean(title.imdbId || title.tmdbId);
}

export function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/** Stops spreadsheet apps from running a title such as `=HYPERLINK(…)` as a formula. */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function toCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}
