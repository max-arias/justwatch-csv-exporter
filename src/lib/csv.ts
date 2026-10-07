import type { SeenTitle } from '../types';

/**
 * Letterboxd import format: movies only. IMDb/TMDB IDs take precedence over
 * title matching. No WatchedDate: JustWatch only knows when a title was marked,
 * which would create misleading diary entries.
 */
export function buildLetterboxdCsv(titles: SeenTitle[]): string {
  const rows = titles
    .filter((title) => title.type === 'movie')
    .map((title) => [neutralizeFormula(title.title), title.year?.toString() ?? '', title.imdbId ?? '', title.tmdbId ?? '']);
  return toCsv([['Title', 'Year', 'imdbID', 'tmdbID'], ...rows]);
}

/**
 * Trakt import format: an external ID is required, so titles without one are
 * omitted. Trakt documents `unknown` for a watch without a known date.
 */
export function buildTraktCsv(titles: SeenTitle[]): string {
  const rows = titles
    .filter(hasExternalId)
    .map((title) => [title.imdbId ?? '', title.tmdbId ?? '', title.type, title.seenAt ?? 'unknown']);
  return toCsv([['imdb_id', 'tmdb_id', 'type', 'watched_at'], ...rows]);
}

export function hasExternalId(title: SeenTitle): boolean {
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
