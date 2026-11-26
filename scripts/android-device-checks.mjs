#!/usr/bin/env node
/**
 * Runs example/'s self-checks on the connected Android device or emulator at
 * several system text sizes, and fails on any check outside the known limits.
 *
 * The example has to be installed already (CI installs a release build, whose
 * JS bundle is inside the APK, so no Metro server is needed). Each run is a
 * cold launch; the checks write one `PRETEXT {json}` line per verdict to
 * logcat, and a `done` line when they finish.
 *
 *   node scripts/android-device-checks.mjs
 *   FONT_SCALES=1.0,2.0 node scripts/android-device-checks.mjs
 */

import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB ?? 'adb';
const PACKAGE = 'com.nitroport';
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const SCALES = (process.env.FONT_SCALES ?? '1.0,1.3,2.0').split(',');
const TIMEOUT_MS = Number(process.env.CHECKS_TIMEOUT_MS ?? 10 * 60 * 1000);

/**
 * Checks that document a limit rather than test a promise. They are listed in
 * the README's Known limits and expected to fail at some sizes.
 */
const KNOWN_LIMITS = new Map([
  [
    'bubble · shrunk to measured width',
    "Android's highQuality breaker can rewrap a narrower box",
  ],
]);

function adb(...args) {
  return execFileSync(ADB, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A logcat line is capped at about 4 kB, so a long verdict can arrive cut
 * short and stop being JSON. Its name and outcome come first, so read those
 * from the text when the whole line will not parse.
 */
function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    const name = line.match(/"name":"([^"]*)"/)?.[1];
    const ok = line.match(/"ok":(true|false)/)?.[1];
    const event = line.match(/"event":"([^"]*)"/)?.[1];
    return event ? { event, name, ok: ok === 'true', truncated: true } : null;
  }
}

function readVerdicts() {
  return adb('logcat', '-d', '-s', 'ReactNativeJS:V')
    .split('\n')
    .map(line => line.match(/PRETEXT (\{.*)$/)?.[1])
    .filter(Boolean)
    .map(parse)
    .filter(Boolean);
}

function runAt(scale) {
  adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
  adb('logcat', '-c');
  adb('shell', 'am', 'force-stop', PACKAGE);
  adb('shell', 'am', 'start', '-n', ACTIVITY);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const verdicts = readVerdicts();
    if (verdicts.some(v => v.event === 'done')) {
      return verdicts.filter(v => v.event === 'check');
    }
    sleep(3000);
  }
  throw new Error(
    `checks did not finish at font scale ${scale} within ${TIMEOUT_MS / 1000}s`,
  );
}

let unexpected = 0;
adb('logcat', '-G', '4M');
try {
  for (const scale of SCALES) {
    const checks = runAt(scale);
    const failed = checks.filter(check => !check.ok);
    console.log(
      `font scale ${scale}: ${checks.length - failed.length}/${checks.length} passed`,
    );
    for (const check of failed) {
      const known = KNOWN_LIMITS.get(check.name);
      console.log(
        `  ${known ? 'expected' : 'FAILED  '} ${check.name}: ${
          check.summary ?? '(verdict cut short in logcat)'
        }${known ? ` — ${known}` : ''}`,
      );
      if (check.details && !known) {
        console.log(`           ${JSON.stringify(check.details)}`);
      }
      if (!known) {
        unexpected += 1;
      }
    }
  }
} finally {
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
}

if (unexpected > 0) {
  console.error(`${unexpected} check(s) failed outside the known limits`);
  process.exit(1);
}
