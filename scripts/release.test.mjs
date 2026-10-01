import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  assertStableVersion,
  packageRelease,
  validateRelease,
  verifyRelease,
} from './release.mjs';

const PACKAGE_NAME = 'test-extension';

function writeProject(directory, version, lockVersion = version, packageRootVersion = version) {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version }, null, 2));
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
    name: PACKAGE_NAME,
    version: lockVersion,
    lockfileVersion: 3,
    packages: { '': { name: PACKAGE_NAME, version: packageRootVersion } },
  }, null, 2));
}

function createFixture(t, version = '1.2.3') {
  const directory = mkdtempSync(join(tmpdir(), 'release-helper-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeProject(directory, version);
  return directory;
}

function git(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function createGitFixture(t, previousVersion, currentVersion) {
  const directory = createFixture(t, previousVersion);
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'user.email', 'release-test@example.invalid']);
  git(directory, ['config', 'user.name', 'Release Test']);
  git(directory, ['add', 'package.json', 'package-lock.json']);
  git(directory, ['commit', '--quiet', '-m', 'previous release']);
  const previousRef = git(directory, ['rev-parse', 'HEAD']);
  writeProject(directory, currentVersion);
  return { directory, previousRef };
}

function writeOutputArtifact(directory, version, name, content = name) {
  const output = join(directory, '.output');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `${PACKAGE_NAME}-${version}-${name}.zip`), content);
}


function writeReleaseMetadata(directory, version, sha, tag = `v${version}`) {
  const artifacts = join(directory, 'release-artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'release.json'), `${JSON.stringify({ version, tag, sha })}\n`);
}

test('stable versions reject malformed values and browser-incompatible components', () => {
  for (const version of ['1.02.3', '1.2', '1.2.3-beta', '0.0.0', '65536.0.0']) {
    assert.throws(() => assertStableVersion(version));
  }
  assert.deepEqual(assertStableVersion('65535.65535.65535'), [65535, 65535, 65535]);
});

test('validate rejects a release branch that does not exactly name the package version', (t) => {
  const directory = createFixture(t);
  assert.throws(
    () => validateRelease({ cwd: directory, env: { RELEASE_BRANCH: 'release/1.2.4', PREVIOUS_REF: '0'.repeat(40) } }),
    /RELEASE_BRANCH must be release\/1\.2\.3/,
  );
});

test('validate rejects a lockfile root version that differs from package.json', (t) => {
  const directory = createFixture(t);
  writeProject(directory, '1.2.3', '1.2.2');
  assert.throws(
    () => validateRelease({ cwd: directory, env: { RELEASE_BRANCH: 'release/1.2.3', PREVIOUS_REF: '0'.repeat(40) } }),
    /package-lock\.json root version/,
  );
});

test('validate rejects an invalid package version before invoking git', (t) => {
  const directory = createFixture(t, '1.02.3');
  assert.throws(
    () => validateRelease({ cwd: directory, env: { RELEASE_BRANCH: 'release/1.02.3', PREVIOUS_REF: '0'.repeat(40) } }),
    /without leading zeroes/,
  );
});

test('validate rejects a lockfile package root version that differs from package.json', (t) => {
  const directory = createFixture(t);
  writeProject(directory, '1.2.3', '1.2.3', '1.2.2');
  assert.throws(
    () => validateRelease({ cwd: directory, env: { RELEASE_BRANCH: 'release/1.2.3', PREVIOUS_REF: '0'.repeat(40) } }),
    /package-lock\.json packages\[""\] version/,
  );
});

test('validate requires a strict numeric increase over the previous commit', (t) => {
  for (const [previousVersion, currentVersion] of [['1.2.3', '1.2.3'], ['1.2.3', '1.2.2']]) {
    const { directory, previousRef } = createGitFixture(t, previousVersion, currentVersion);
    assert.throws(
      () => validateRelease({ cwd: directory, env: { RELEASE_BRANCH: `release/${currentVersion}`, PREVIOUS_REF: previousRef } }),
      /must be strictly greater/,
    );
  }
});

test('validate accepts a strict increase at the browser numeric boundary', (t) => {
  const { directory, previousRef } = createGitFixture(t, '65535.65535.65534', '65535.65535.65535');
  const release = validateRelease({
    cwd: directory,
    env: { RELEASE_BRANCH: 'release/65535.65535.65535', PREVIOUS_REF: previousRef },
  });

  assert.deepEqual(release, { name: PACKAGE_NAME, version: '65535.65535.65535', tag: 'v65535.65535.65535' });
});

test('package fails when a required WXT artifact is missing', (t) => {
  const directory = createFixture(t);
  writeOutputArtifact(directory, '1.2.3', 'chrome');
  assert.throws(
    () => packageRelease({ cwd: directory, env: { RELEASE_SHA: 'a'.repeat(40) } }),
    /Missing WXT artifact test-extension-1\.2\.3-firefox\.zip/,
  );
});

test('verify rejects tampered metadata', (t) => {
  const { directory } = createGitFixture(t, '1.2.3', '1.2.3');
  const head = git(directory, ['rev-parse', 'HEAD']);
  writeReleaseMetadata(directory, '1.2.3', head, 'v9.9.9');
  assert.throws(() => verifyRelease({ cwd: directory, env: {} }), /release metadata must match package version and tag/);
});

test('verify rejects metadata SHA that does not match checked-out HEAD', (t) => {
  const { directory } = createGitFixture(t, '1.2.3', '1.2.3');
  writeReleaseMetadata(directory, '1.2.3', '0'.repeat(40));
  assert.throws(() => verifyRelease({ cwd: directory, env: {} }), /must match checked-out HEAD/);
});

test('verify rejects artifact payloads that no longer match their metadata hashes', (t) => {
  const { directory } = createGitFixture(t, '1.2.3', '1.2.3');
  const head = git(directory, ['rev-parse', 'HEAD']);
  writeOutputArtifact(directory, '1.2.3', 'chrome', 'chrome payload');
  writeOutputArtifact(directory, '1.2.3', 'firefox', 'firefox payload');
  writeOutputArtifact(directory, '1.2.3', 'sources', 'source payload');
  packageRelease({ cwd: directory, env: { RELEASE_SHA: head } });
  writeFileSync(join(directory, 'release-artifacts', 'chrome.zip'), 'tampered payload');

  assert.throws(() => verifyRelease({ cwd: directory, env: {} }), /does not match its release metadata SHA-256 hash/);
});
