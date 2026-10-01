import {
  appendFileSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

const ARTIFACT_NAMES = ['chrome.zip', 'firefox.zip', 'firefox-sources.zip'];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function assertStableVersion(version, label = 'version') {
  if (typeof version !== 'string') {
    throw new Error(`${label} must be a stable X.Y.Z version`);
  }

  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`${label} must be a stable X.Y.Z version without leading zeroes`);
  }

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 65_535)) {
    throw new Error(`${label} components must be browser-safe integers from 0 through 65535`);
  }
  if (parts.every((part) => part === 0)) {
    throw new Error(`${label} must not be 0.0.0`);
  }

  return parts;
}

export function compareVersions(left, right) {
  const leftParts = assertStableVersion(left, 'left version');
  const rightParts = assertStableVersion(right, 'right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

export function readJson(path, label = path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

export function readReleaseVersions(cwd = process.cwd()) {
  const packageJson = readJson(join(cwd, 'package.json'), 'package.json');
  const lockfile = readJson(join(cwd, 'package-lock.json'), 'package-lock.json');
  const version = packageJson.version;

  assertStableVersion(version, 'package.json version');
  if (lockfile.version !== version) {
    throw new Error(`package-lock.json root version (${lockfile.version}) must match package.json version (${version})`);
  }
  if (lockfile.packages?.['']?.version !== version) {
    throw new Error(`package-lock.json packages[""] version (${lockfile.packages?.['']?.version}) must match package.json version (${version})`);
  }

  return { name: packageJson.name, version, tag: `v${version}` };
}

function assertCommitSha(sha, label) {
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) {
    throw new Error(`${label} must be an exact 40-character lowercase hexadecimal Git SHA`);
  }
  return sha;
}

function readPreviousVersion(previousRef, cwd) {
  assertCommitSha(previousRef, 'PREVIOUS_REF');
  let packageText;
  try {
    packageText = execFileSync('git', ['show', `${previousRef}:package.json`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Cannot read package.json from PREVIOUS_REF ${previousRef}${detail ? `: ${detail}` : ''}`);
  }

  let previousPackage;
  try {
    previousPackage = JSON.parse(packageText);
  } catch (error) {
    throw new Error(`PREVIOUS_REF ${previousRef} package.json is invalid JSON: ${error.message}`);
  }
  assertStableVersion(previousPackage.version, 'PREVIOUS_REF package.json version');
  return previousPackage.version;
}

export function writeGitHubOutput(values, env = process.env) {
  if (!env.GITHUB_OUTPUT) {
    return;
  }
  const content = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  appendFileSync(env.GITHUB_OUTPUT, `${content}\n`);
}

export function validateRelease({ cwd = process.cwd(), env = process.env } = {}) {
  const release = readReleaseVersions(cwd);
  if (env.RELEASE_BRANCH !== `release/${release.version}`) {
    throw new Error(`RELEASE_BRANCH must be release/${release.version}; received ${env.RELEASE_BRANCH ?? '(unset)'}`);
  }

  const previousVersion = readPreviousVersion(env.PREVIOUS_REF, cwd);
  if (compareVersions(release.version, previousVersion) <= 0) {
    throw new Error(`package.json version (${release.version}) must be strictly greater than PREVIOUS_REF version (${previousVersion})`);
  }

  writeGitHubOutput({ version: release.version, tag: release.tag }, env);
  return release;
}

function assertRegularFile(path, label) {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    throw new Error(`Missing ${label}: ${path}`);
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`${label} must be a regular file, not a symbolic link: ${path}`);
  }
}

function assertRealDirectory(path, label) {
  try {
    const status = lstatSync(path);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(`${label} must be a real directory, not a symbolic link: ${path}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Missing ${label}: ${path}`);
    }
    throw error;
  }
}

function ensureArtifactDirectory(path) {
  try {
    const status = lstatSync(path);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(`release artifact directory must be a real directory, not a symbolic link: ${path}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      mkdirSync(path, { recursive: true });
      return;
    }
    throw error;
  }
}

function assertSafeDestination(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`release artifact destination must not be a symbolic link: ${path}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verifyArtifactHashes(files, artifactDirectory) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('release metadata must include artifact SHA-256 hashes');
  }

  for (const name of ARTIFACT_NAMES) {
    const expected = files[name];
    if (typeof expected !== 'string' || !SHA256_PATTERN.test(expected)) {
      throw new Error(`release metadata must include a SHA-256 hash for ${name}`);
    }
    const artifactPath = join(artifactDirectory, name);
    assertRegularFile(artifactPath, `release artifact ${name}`);
    if (sha256File(artifactPath) !== expected) {
      throw new Error(`release artifact ${name} does not match its release metadata SHA-256 hash`);
    }
  }
}

export function packageRelease({ cwd = process.cwd(), env = process.env } = {}) {
  const packageJson = readJson(join(cwd, 'package.json'), 'package.json');
  const version = packageJson.version;
  assertStableVersion(version, 'package.json version');
  if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
    throw new Error('package.json name must be a non-empty string');
  }
  const sha = assertCommitSha(env.RELEASE_SHA, 'RELEASE_SHA');
  const release = { version, tag: `v${version}`, sha, files: {} };
  const outputDirectory = join(cwd, '.output');
  const artifactDirectory = join(cwd, 'release-artifacts');
  const artifacts = [
    [`${packageJson.name}-${version}-chrome.zip`, 'chrome.zip'],
    [`${packageJson.name}-${version}-firefox.zip`, 'firefox.zip'],
    [`${packageJson.name}-${version}-sources.zip`, 'firefox-sources.zip'],
  ];

  assertRealDirectory(outputDirectory, 'WXT output directory');
  ensureArtifactDirectory(artifactDirectory);
  for (const [sourceName, targetName] of artifacts) {
    const source = join(outputDirectory, sourceName);
    const target = join(artifactDirectory, targetName);
    assertRegularFile(source, `WXT artifact ${sourceName}`);
    assertSafeDestination(target);
    copyFileSync(source, target);
    release.files[targetName] = sha256File(target);
  }

  const metadataPath = join(artifactDirectory, 'release.json');
  assertSafeDestination(metadataPath);
  writeFileSync(metadataPath, `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

function readHeadSha(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Cannot determine checked-out HEAD${detail ? `: ${detail}` : ''}`);
  }
}

export function verifyRelease({ cwd = process.cwd(), env = process.env } = {}) {
  const release = readReleaseVersions(cwd);
  const artifactDirectory = join(cwd, 'release-artifacts');
  const metadataPath = join(artifactDirectory, 'release.json');
  assertRegularFile(metadataPath, 'release metadata');
  const metadata = readJson(metadataPath, 'release-artifacts/release.json');
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('release-artifacts/release.json must contain an object');
  }

  assertStableVersion(metadata.version, 'release metadata version');
  assertCommitSha(metadata.sha, 'release metadata sha');
  if (metadata.version !== release.version || metadata.tag !== release.tag) {
    throw new Error(`release metadata must match package version and tag (${release.version}, ${release.tag})`);
  }

  const head = assertCommitSha(readHeadSha(cwd), 'checked-out HEAD');
  if (metadata.sha !== head) {
    throw new Error(`release metadata SHA (${metadata.sha}) must match checked-out HEAD (${head})`);
  }

  verifyArtifactHashes(metadata.files, artifactDirectory);

  const verified = { ...release, sha: metadata.sha };
  writeGitHubOutput({ version: verified.version, tag: verified.tag, sha: verified.sha }, env);
  return verified;
}

export function main(argv = process.argv.slice(2), options = {}) {
  if (argv.length !== 1 || !['validate', 'package', 'verify'].includes(argv[0])) {
    throw new Error('Usage: node scripts/release.mjs <validate|package|verify>');
  }
  const commands = {
    validate: validateRelease,
    package: packageRelease,
    verify: verifyRelease,
  };
  return commands[argv[0]](options);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exitCode = 1;
  }
}
