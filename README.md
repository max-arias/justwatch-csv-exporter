# justwatch-csv-exporter

## Loading a list

Click the extension icon on a JustWatch page to open the exporter. On any other page,
the click opens `https://www.justwatch.com/` in a new tab instead (the page you were on
is left alone); click the icon again there. Tabs on other sites expose no URL to the
extension, so anything that is not `www.justwatch.com` counts as "not JustWatch".

The popup has two tabs, **Seen** and **Watchlist**. Nothing loads automatically: each tab
has its own Load button. Lists come from JustWatch's own GraphQL API
(`apis.justwatch.com/graphql`, list type `SEENLIST` or `WATCHLIST`), the same request the
site's list pages make. No page content is scraped, so URL language, page layout, and list
length do not matter.

- **Tab:** the JustWatch tab you clicked from is used. If it has no usable session within
  5 seconds (e.g. an expired token), the extension opens `https://www.justwatch.com/` in a
  background tab and closes it when done, unless you switched to it.
- **Session:** requests are sent from inside that tab with the page's own access token
  (`localStorage["jw/user"].accessToken`) and device ID. A page the extension opened gets
  up to 15 seconds to refresh an expired token. If JustWatch rejects the token mid-load,
  the session is renewed once in a freshly loaded tab and the same page is retried.
- **Country:** taken from the tab URL (`/<country>/…`) or, on the homepage, from the
  Lists link (`[data-testid="navbar-watchlist"]`). Titles are requested in English with
  `includeTitlesWithoutUrl`, so the list is complete in every country.
- **Data:** each entry provides its type (`MOVIE`/`SHOW`), English title, release year,
  IMDb/TMDB IDs, the date it was added to the list (Seen: marked seen, series: tracking
  started; Watchlist: added to the watchlist), and episode progress for series. Other entry
  types are counted as skipped. Entries repeated across pages are dropped.

### Load on JustWatch

- One load at a time across both lists (the other tab's Load button is disabled), 20
  titles per request (the site's page size), with 400 ms between pages. The popup shows
  progress (`120/634`).
- Each request times out after 20 seconds. Timeouts, network failures, HTTP 408/429/5xx,
  and GraphQL rate-limit errors are retried up to 4 attempts with exponential backoff
  (2 s, 4 s, 8 s), or `Retry-After` when longer, capped at 60 seconds.
- Paging stops on a missing or repeated cursor, and never exceeds the pages implied by
  the reported total plus 5 (hard cap 1,000 pages).
- Opening JustWatch times out after 30 seconds; script injection has its own timeout.

### Errors and saved state

Errors name the cause when you can act on it: not signed in (sign in on the JustWatch page
and load the list again), JustWatch not loading properly (e.g. a block page), country not
detected, JustWatch not responding after retries, or a slow load. Anything else, such as a
rejected session or the tab closing mid-load, shows "Something went wrong. Please try
again." Details are logged in the background console.

The background records the outcome of the latest load of each list (in progress, the
list, or the error) in `storage.session`, so it survives closing the popup and is cleared
when the browser closes. Opening the popup shows the last selected tab and its stored
outcome without reloading; **Load**/**Reload** starts a new load. Closing the popup does
not cancel a load. A new load replaces that list's stored result, so signing out and
reloading removes it. If the background worker restarts mid-load, the popup reports the
load as interrupted instead of spinning forever.

## Exports

Files are saved by the background through the downloads API, so closing the popup (for
example when a "Save as" dialog opens) cannot cancel them.

Files are named `justwatch-<seen|watchlist>-<letterboxd|trakt>-<date>.csv`.

- **Letterboxd:** movies only, `Title,Year,imdbID,tmdbID`. IDs take precedence over
  title matching. No `WatchedDate` is written, because JustWatch only records when a
  title was marked, which would create misleading diary entries. Import a Watchlist
  export into your Letterboxd watchlist.
- **Trakt:** Seen exports use `imdb_id,tmdb_id,type,watched_at`, with the date the title
  was marked (series: when tracking started), or `unknown` when JustWatch has none.
  Watchlist exports use `watchlisted_at` instead, with the date the title was added, or
  the export time when JustWatch has none. Titles without an IMDb or TMDB ID are omitted
  because Trakt cannot match them. A seen `show` row marks the whole series as watched;
  partially seen series are labelled with their progress in the popup so you can
  deselect them.
- Titles starting with `=`, `+`, `-`, or `@` are prefixed with `'` so spreadsheet apps
  do not run them as formulas.

## Requirements

Chrome/Edge 119+ and Firefox 121+ (declared in the manifest). Permissions: `downloads`
(CSV files), `scripting` and access to `www.justwatch.com` (session and API requests from
a JustWatch tab), and `storage` (last result).

## Automated releases

Normal pushes to `main` do not publish anything. Merge a same-repository PR from
`release/<version>` into `main` to build that merge commit, create a GitHub release,
and submit the packages to Chrome, Edge, and Firefox sequentially in one job.
Each step gets only its own store credentials. A store failure does not prevent
the remaining selected stores from being attempted, but the job still fails.
Store review determines when each update becomes available.
Publishing uses WXT's built-in `wxt submit` command, following its
[official Actions example](https://wxt.dev/guide/essentials/publishing.html#github-action).
The repository-specific code handles release branches, version validation, artifact
integrity, and retries; it does not implement store APIs.

### One-time store setup

Create and submit the first listing manually in each store, then add these
**repository Actions secrets** in GitHub Settings → Secrets and variables → Actions:

| Store | Required secrets |
| --- | --- |
| Chrome | `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Edge | `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` |
| Firefox | `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` |

The installed WXT submission helper uses Chrome OAuth credentials and the current
Edge API-key authentication. `FIREFOX_EXTENSION_ID` must be the actual Firefox
add-on ID, not its store URL or numeric listing ID; it is also embedded in Firefox's
manifest during packaging. UUID IDs include their braces
(`{8c8f60ab-6439-48c9-8be8-a09c857dd31e}`); a bare UUID makes AMO answer 404 and is
rejected by the release check. The submit step percent-encodes the braces, because the
submission helper strips literal braces and AMO cannot find a bare UUID.

`npx wxt submit init` can guide credential setup locally. Never commit its
`.env.submit` file or any other credential file; `.env*` files are ignored.
The workflows use repository secrets, not local configuration files.

Enable Actions. The packaging job requests `contents: write` to create tags and
GitHub releases; the repository's default workflow permission can remain read-only.
For branch protection on `main`, require the `Validate release pull request` check
for release PRs. Store credentials are never used in the pre-merge PR check.

### Cut a release

Start the release branch from up-to-date `main`. For example:

```sh
git switch main
git pull --ff-only
git switch -c release/0.1.1
npm version 0.1.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): 0.1.1"
git push -u origin release/0.1.1
```

Open a PR into `main`, wait for validation, then merge it. The version must be a
stable `major.minor.patch` version, match the branch name and both lockfile version
fields, and be greater than the previous version on `main`. Prerelease suffixes
and components greater than 65535 are not accepted.
Use **Squash and merge** or **Create a merge commit** for release PRs: the merged
workflow compares the version with the merge commit's first parent. With rebase
merging, the version bump must be the final commit so its immediate predecessor
still has the previous version.

The workflow does not bump versions or push release commits. It creates
`v<version>` at the exact merge commit and attaches `chrome.zip` and `firefox.zip`
to the GitHub release. Edge uses the same Chrome MV3 package; Firefox uses MV2.
An existing tag/release is not overwritten.

The complete `release-packages` Actions artifact also contains `firefox-sources.zip`
and `release.json`. The source ZIP is not attached to the public GitHub release.
Actions artifacts are retained for 90 days, subject to repository retention limits;
they are not a long-term backup. Do not publish the source ZIP separately without
checking its contents for secrets.
Artifact access follows repository permissions; in a public repository,
authenticated users can download artifacts, so this is not private secret storage.

### Retry a store submission

In Actions, open the **Release** workflow and choose **Run workflow** on `main`.
Supply the original release workflow's numeric run ID (from its URL), select
`chrome`, `edge`, `firefox`, or `all`, and keep `dry_run` enabled first.

A dry run checks authentication without uploading or submitting. Disable it to
actually submit the retained packages. Retry only stores that failed; resubmitting
an already accepted version may be rejected by that store.

Retries verify the original workflow run and package metadata, use its original
commit and retained ZIPs, and do not rebuild, bump the version, or recreate the
GitHub release. They require the original packaging job to have succeeded and
the Actions artifact to remain available. Submission jobs are serialized without
cancelling an in-progress submission. GitHub concurrency retains only one pending
job, so finish the current release before merging another release PR.

### Local packaging and Firefox source review

```sh
npm ci
npm run test:release
npm test
npm run typecheck
npm run zip:chrome
FIREFOX_EXTENSION_ID='your-actual-addon-id' npm run zip:firefox
```

The Firefox manifest declares no data collection or transmission: the Seen list and
Watchlist are requested from JustWatch with the user's own JustWatch session, and CSV export writes
local files. Nothing is sent anywhere else. Update this declaration if the extension
later transmits extracted data.

For Mozilla reviewers, extract the `*-sources.zip`, install dependencies with
`npm ci`, and run `FIREFOX_EXTENSION_ID='<ID from the submitted manifest>' npm run
zip:firefox` to reproduce the submitted Firefox package. The ID is public manifest
metadata, not a credential. No publishing credentials are needed to build.
Tailwind class discovery is scoped to `entrypoints/popup`, so release scripts,
workflow files, and files omitted from the source ZIP cannot change the generated CSS.

References: [WXT publishing](https://wxt.dev/guide/essentials/publishing.html),
[Edge publishing API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api),
and [Firefox data declarations](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
