# justwatch-csv-exporter

## Scanning

Click the extension icon from any page. The extension automatically navigates the
**current tab** to your JustWatch Seen list and starts extraction. It does not open
a new tab; the current page is replaced:

- If the current JustWatch URL already identifies your country, it uses that country.
- Otherwise it opens `https://www.justwatch.com/`, waits for the homepage, and
  reads the destination of the Lists link (`[data-testid="navbar-watchlist"]`).
  That destination identifies the country without relying on the link's translated text.
- It opens `https://www.justwatch.com/<country>/lists/my-lists?inner_tab=seenlist`
  and waits for the page to load. No country is hardcoded or used as a fallback.

The popup displays **Opening Seen list...** during navigation, then **Scanning...**
while extracting titles. No additional button press is required. Once finished,
choose the titles to export, or press **Scan Again** to repeat extraction.
You must be signed in to JustWatch to access your Seen list.

After navigation, the extension waits for the list controls to appear, selects the
detailed layout, then scrolls and scans. Navigation and layout selection use URLs
and CSS selectors, not translated labels such as “My Lists” or “Seen”.
Navigation and scanning continue if the popup is closed. Opening the extension
again while extraction is running continues that scan; opening it after completion
starts a new extraction of the current tab.

If loading stalls, country discovery fails, or the tab closes, the extension reports
an error instead of guessing a country or scanning the wrong page. A missing list
view asks you to sign in and try again.

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
manifest during packaging.

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

The Firefox manifest declares no data collection or transmission: scanning reads
the rendered JustWatch page and CSV export writes local files. Update this
declaration if the extension later transmits extracted data.

For Mozilla reviewers, extract the `*-sources.zip`, install dependencies with
`npm ci`, and run `FIREFOX_EXTENSION_ID='<ID from the submitted manifest>' npm run
zip:firefox` to reproduce the submitted Firefox package. The ID is public manifest
metadata, not a credential. No publishing credentials are needed to build.
Tailwind class discovery is scoped to `entrypoints/popup`, so release scripts,
workflow files, and files omitted from the source ZIP cannot change the generated CSS.

References: [WXT publishing](https://wxt.dev/guide/essentials/publishing.html),
[Edge publishing API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api),
and [Firefox data declarations](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
