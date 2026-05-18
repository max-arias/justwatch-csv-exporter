import type { ExternalId, JustWatchItem, JustWatchItemType, ScanSummary } from '../types';

const LINK_TYPE_PATTERNS: Array<[RegExp, JustWatchItemType]> = [
  [/\/(?:pelicula|movie)\//i, 'movie'],
  [/\/(?:serie|tv-show|show)\//i, 'show'],
  [/\/season\//i, 'season'],
  [/\/episode\//i, 'episode'],
];

export function parseJustWatchListHtml(html: string, baseUrl = 'https://www.justwatch.com/'): JustWatchItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseJustWatchListDocument(doc, baseUrl);
}

export function parseJustWatchListDocument(doc: Document, baseUrl = doc.baseURI): JustWatchItem[] {
  const cards = Array.from(doc.querySelectorAll('.title-card'));

  return cards
    .map((card) => parseCard(card, baseUrl))
    .filter((item): item is JustWatchItem => Boolean(item));
}

export async function enrichItemsWithExternalIds(
  items: JustWatchItem[],
  baseUrl: string,
  fetchHtml: (url: string) => Promise<string>,
): Promise<JustWatchItem[]> {
  const enriched: JustWatchItem[] = [];

  for (const item of items) {
    if (item.externalIds.length > 0) {
      enriched.push(item);
      continue;
    }

    try {
      const html = await fetchHtml(new URL(item.href, baseUrl).toString());
      const externalIds = extractExternalIds(html);
      enriched.push({
        ...item,
        externalIds,
        unresolvedReason: externalIds.length ? undefined : 'No external ID found on list or detail page',
      });
    } catch (error) {
      enriched.push({
        ...item,
        unresolvedReason: error instanceof Error ? error.message : 'Failed to fetch detail page',
      });
    }
  }

  return enriched;
}

export function extractExternalIds(text: string): ExternalId[] {
  const ids = new Map<string, ExternalId>();

  for (const match of text.matchAll(/\btt\d{7,9}\b/gi)) {
    addId(ids, { kind: 'imdb_id', value: match[0].toLowerCase() });
  }

  for (const match of text.matchAll(/\b(?:tmdb[_-]?id|tmdbId|themoviedb)["'\s:=]+(\d{1,10})\b/gi)) {
    addId(ids, { kind: 'tmdb_id', value: match[1] });
  }

  for (const match of text.matchAll(/\b(?:tvdb[_-]?id|tvdbId)["'\s:=]+(\d{1,10})\b/gi)) {
    addId(ids, { kind: 'tvdb_id', value: match[1] });
  }

  return Array.from(ids.values());
}

export function buildScanSummary(items: JustWatchItem[]): ScanSummary {
  return {
    scanned: items.length,
    letterboxdRows: items.filter((item) => item.type === 'movie' && item.title && item.year).length,
    traktRows: items.filter((item) => item.type !== 'unknown' && item.externalIds.length > 0).length,
    unresolvedRows: items.filter((item) => item.type === 'unknown' || item.externalIds.length === 0).length,
  };
}

function parseCard(card: Element, baseUrl: string): JustWatchItem | undefined {
  const heading = card.querySelector('.title-card-heading');
  const title = heading ? getDirectText(heading).trim() : '';
  const year = card.querySelector('.title-card-heading__info')?.textContent?.match(/\d{4}/)?.[0];
  const href = findDetailHref(card);
  if (!title || !href) return undefined;

  const url = new URL(href, baseUrl).toString();
  const type = classifyHref(href);
  const rawHtml = card.outerHTML;
  const externalIds = extractExternalIds(rawHtml);

  return {
    title: decodeEntities(title),
    year,
    type,
    href,
    url,
    posterId: rawHtml.match(/images\.justwatch\.com\/poster\/(\d+)\//)?.[1],
    externalIds,
    unresolvedReason:
      type === 'unknown' ? 'Could not classify JustWatch URL path' : undefined,
  };
}

function findDetailHref(card: Element): string | undefined {
  const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'));
  return anchors.find((anchor) => classifyHref(anchor.getAttribute('href') ?? '') !== 'unknown')?.getAttribute('href') ?? undefined;
}

function classifyHref(href: string): JustWatchItemType {
  return LINK_TYPE_PATTERNS.find(([pattern]) => pattern.test(href))?.[1] ?? 'unknown';
}

function getDirectText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ');
}

function decodeEntities(value: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function addId(ids: Map<string, ExternalId>, id: ExternalId) {
  ids.set(`${id.kind}:${id.value}`, id);
}
