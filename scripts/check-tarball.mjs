/**
 * Asserts that the tarball npm would publish is actually installable.
 *
 * Two failures are possible here and neither shows up in a test run, because
 * both are about what `files` lets through rather than about the code:
 *
 *  - **Missing Nitro glue.** `nitrogen/generated/` is gitignored but listed in
 *    `files`, so a checkout that skipped codegen produces a tarball that
 *    installs and then fails to build — in the consumer's project, not ours.
 *  - **Build output leaking in.** `"android/"` in `files` is a directory
 *    allowlist and npm honours it over `.gitignore`. Before the `!android/build`
 *    negations this shipped a 222 MB `libreactnative.so` inside a 76 MB
 *    tarball: published, installable, and wrong in a way nothing complained
 *    about.
 *
 * Inspects the real archive rather than trusting the config, so it keeps
 * holding when `files` is edited again later.
 *
 * Usage: `npm pack` first, then `node scripts/check-tarball.mjs [file.tgz]`.
 * Deliberately does not run `npm pack` itself — `prepare` writes to stdout,
 * which would have to be untangled from `--json` output for no benefit.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';

/** Currently ~37 kB. Generous enough not to nag, tight enough to catch a leak. */
const MAX_BYTES = 250 * 1024;

/** Must be present, relative to the tarball's `package/` root. */
const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'nitro.json',
  'PreText.podspec',
  'src/index.ts',
  'src/PreText.nitro.ts',
  'ios/PreText.swift',
  'android/src/main/java/com/margelo/nitro/pretext/PreText.kt',
  'android/build.gradle',
  'android/CMakeLists.txt',
  // The generated glue, one entry per platform it has to satisfy.
  'nitrogen/generated/ios/PreText+autolinking.rb',
  'nitrogen/generated/ios/swift/HybridPreTextSpec.swift',
  'nitrogen/generated/android/pretext+autolinking.cmake',
  'nitrogen/generated/android/kotlin/com/margelo/nitro/pretext/HybridPreTextSpec.kt',
  'nitrogen/generated/shared/c++/HybridPreTextSpec.hpp',
];

/** Must not appear at all. */
const FORBIDDEN_PREFIXES = [
  'android/build/',
  'android/.cxx/',
  'example/',
  'node_modules/',
];

function fail(message) {
  console.error(`\n  tarball check failed: ${message}\n`);
  process.exit(1);
}

const tarball =
  process.argv[2] ?? readdirSync('.').find(name => name.endsWith('.tgz'));

if (!tarball) {
  fail('no .tgz found — run `npm pack` first, or pass the path as an argument');
}

const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  // Every path in an npm tarball sits under `package/`.
  .map(line => line.replace(/^package\//, ''))
  // Directory entries end in a slash and carry no information here.
  .filter(line => !line.endsWith('/'));

const present = new Set(entries);
const missing = REQUIRED.filter(path => !present.has(path));
const leaked = entries.filter(path =>
  FORBIDDEN_PREFIXES.some(prefix => path.startsWith(prefix)),
);
const { size } = statSync(tarball);
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));

console.log(`  ${name}@${version} — ${tarball}`);
console.log(`  ${entries.length} files · ${(size / 1024).toFixed(1)} kB packed`);

if (missing.length > 0) {
  fail(
    `${missing.length} required path(s) absent — run \`npm run codegen\` if they are under nitrogen/:\n    ` +
      missing.join('\n    '),
  );
}

if (leaked.length > 0) {
  const shown = leaked.slice(0, 10);
  fail(
    `${leaked.length} path(s) that must not ship:\n    ` +
      shown.join('\n    ') +
      (leaked.length > shown.length
        ? `\n    …and ${leaked.length - shown.length} more`
        : ''),
  );
}

if (size > MAX_BYTES) {
  fail(
    `packed size ${(size / 1024).toFixed(1)} kB exceeds the ${(
      MAX_BYTES / 1024
    ).toFixed(0)} kB ceiling — either something is leaking in, or the ceiling ` +
      `needs raising on purpose.`,
  );
}

console.log('  ok — glue present, no build output, size within ceiling\n');
