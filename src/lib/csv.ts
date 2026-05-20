import type { JustWatchItem } from '../types';

export interface ExportFilters {
  movies: boolean;
  series: boolean;
}

const ALL_TYPES: ExportFilters = { movies: true, series: true };

export function buildLetterboxdCsv(items: JustWatchItem[], filters: ExportFilters = ALL_TYPES): string {
  const rows = items
    .filter((item) => filters.movies && item.type === 'movie' && item.title && item.year)
    .map((item) => [item.title, item.year ?? '']);

  return toCsv([['Title', 'Year'], ...rows]);
}

export function buildTraktCsv(items: JustWatchItem[], filters: ExportFilters = ALL_TYPES): string {
  const rows = items
    .filter((item) => isIncludedByType(item, filters) && item.title && item.year)
    .map((item) => [item.title, item.year ?? '', item.type, 'watched']);

  return toCsv([['title', 'year', 'type', 'action'], ...rows]);
}

export function countLetterboxdRows(items: JustWatchItem[], filters: ExportFilters): number {
  return items.filter((item) => filters.movies && item.type === 'movie' && item.title && item.year).length;
}

export function countTraktRows(items: JustWatchItem[], filters: ExportFilters): number {
  return items.filter((item) => isIncludedByType(item, filters) && item.title && item.year).length;
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

function isIncludedByType(item: JustWatchItem, filters: ExportFilters): boolean {
  return (filters.movies && item.type === 'movie') || (filters.series && item.type === 'show');
}
