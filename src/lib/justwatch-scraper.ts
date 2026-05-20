import type { ExternalId, JustWatchItem, JustWatchItemType, ScanSummary } from '../types';

const LINK_TYPE_PATTERNS: Array<[RegExp, JustWatchItemType]> = [
  [/\/(?:pelicula|movie)\//i, 'movie'],
  [/\/(?:serie|tv-show|show)\//i, 'show'],
  [/\/season\//i, 'season'],
  [/\/episode\//i, 'episode'],
];

const DEFAULT_DELAY_BETWEEN_DETAIL_REQUESTS_MS = 2_000;
const DEFAULT_MAX_DETAIL_REQUESTS_PER_SCAN = 40;

export interface EnrichItemsOptions {
  delayBetweenRequestsMs?: number;
  maxDetailRequests?: number;
  delay?: (ms: number) => Promise<void>;
}

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
  options: EnrichItemsOptions = {},
): Promise<JustWatchItem[]> {
  const enriched: JustWatchItem[] = [];
  const delayBetweenRequestsMs = options.delayBetweenRequestsMs ?? DEFAULT_DELAY_BETWEEN_DETAIL_REQUESTS_MS;
  const maxDetailRequests = options.maxDetailRequests ?? DEFAULT_MAX_DETAIL_REQUESTS_PER_SCAN;
  const delay = options.delay ?? sleep;
  let detailRequests = 0;

  for (const item of items) {
    if (item.externalIds.length > 0) {
      enriched.push(item);
      continue;
    }

    if (detailRequests >= maxDetailRequests) {
      enriched.push({
        ...item,
        unresolvedReason: 'Skipped detail fetch to keep the scan within a safe request limit',
      });
      continue;
    }

    try {
      if (detailRequests > 0 && delayBetweenRequestsMs > 0) {
        await delay(delayBetweenRequestsMs);
      }

      detailRequests += 1;
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
        unresolvedReason: isRateLimitError(error)
          ? 'JustWatch rate limited detail-page requests; stopped fetching more details to avoid overloading the site'
          : error instanceof Error ? error.message : 'Failed to fetch detail page',
      });

      if (isRateLimitError(error)) {
        enriched.push(
          ...items.slice(enriched.length).map((remainingItem) => ({
            ...remainingItem,
            unresolvedReason: remainingItem.externalIds.length
              ? remainingItem.unresolvedReason
              : 'Skipped detail fetch because JustWatch rate limited previous requests',
          })),
        );
        break;
      }
    }
  }

  return enriched;
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && /(?:\b429\b|too many requests|rate limit)/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
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
    traktRows: items.filter((item) => (item.type === 'movie' || item.type === 'show') && item.title && item.year).length,
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
  const description = card.querySelector('.title-card-basic__description p')?.textContent?.trim();
  const posterUrl = card.querySelector<HTMLImageElement>('img[src*="images.justwatch.com/poster/"]')?.getAttribute('src');

  return {
    title: decodeEntities(title),
    year,
    type,
    href,
    url,
    posterId: rawHtml.match(/images\.justwatch\.com\/poster\/(\d+)\//)?.[1],
    posterUrl: posterUrl ? new URL(posterUrl, baseUrl).toString() : undefined,
    description: description ? decodeEntities(description) : undefined,
    imdbRating: getRating(card, 'IMDB'),
    watchProvider: card.querySelector<HTMLImageElement>('.watch-now-button-contents img[alt]')?.alt,
    seen: Boolean(card.querySelector('.mark-as-seen-button.is-marked, [aria-label="Mark as unseen"] .title-poster-quick-actions-content__bubbles__item--selected')),
    externalIds,
    unresolvedReason:
      type === 'unknown' ? 'Could not classify JustWatch URL path' : undefined,
  };
}

function getRating(card: Element, ratingProvider: string): string | undefined {
  const providerLogo = Array.from(card.querySelectorAll<HTMLImageElement>('.jw-scoring-listing img[alt]'))
    .find((img) => img.alt.toLowerCase() === ratingProvider.toLowerCase());
  const ratingText = providerLogo
    ?.closest('.jw-scoring-listing__rating--group')
    ?.querySelector('.nowrap')
    ?.textContent
    ?.trim();

  return ratingText && /^\d+(?:\.\d+)?$/.test(ratingText) ? ratingText : undefined;
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
