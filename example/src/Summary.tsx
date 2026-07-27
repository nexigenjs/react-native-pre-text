import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  clearCache,
  getFontMetrics,
  measure,
  measureBatch,
  measureWidth,
} from '@nexigen/react-native-pre-text';

import { SAMPLES } from './corpus';
import { FONT, TOLERANCE, formatMs, now, useRestartingClock } from './metrics';

const TEXTS = SAMPLES.map(sample => sample.text);

/**
 * How many times to repeat each timed workload.
 *
 * One `measure()` call runs well under a millisecond, which is the same order
 * as `performance.now()`'s own resolution — timing a single call mostly reports
 * the clock, not the work, and dividing that by the case count manufactures
 * absurdities like 0.0002 ms. Timing a whole pass over all cases puts each
 * sample into the milliseconds where the clock is trustworthy, and the median
 * of several passes drops the one that collided with a GC.
 */
const PASSES = 10;

/**
 * Median wall time of `PASSES` runs of `run`.
 *
 * `before` runs outside the timed window, which is what makes a cold number
 * possible: the native layer caches measurements, so without clearing between
 * passes everything after the first would be a cache hit and the median would
 * report lookup time dressed up as measurement time.
 */
function benchmark(run: () => void, before?: () => void): number {
  const samples: number[] = [];
  for (let pass = 0; pass < PASSES; pass++) {
    before?.();
    const started = now();
    run();
    samples.push(now() - started);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

const CASES = SAMPLES.length;

type RenderedLayout = {
  width: number;
  height: number;
  constraint: number;
};

type Miss = {
  id: string;
  kind: string;
  renderedWidth: number;
  renderedHeight: number;
  deltaWidth: number | null;
  deltaHeight: number;
  deltaIntrinsic: number | null;
};

export function Summary({ width }: { width: number }) {
  const [layouts, setLayouts] = useState<Record<string, RenderedLayout>>({});

  /**
   * When the renderer was handed this batch, and when it last answered. Refs,
   * not state: the timestamp must not itself schedule the re-render it times.
   */
  const startedWaitingAt = useRestartingClock(width);
  const lastLayoutAt = useRef(0);

  const onProbeLayout = useCallback(
    (id: string, renderedWidth: number, renderedHeight: number) => {
      lastLayoutAt.current = now();
      setLayouts(previous => {
        const current = previous[id];
        return current &&
          Math.abs(current.width - renderedWidth) < 0.01 &&
          Math.abs(current.height - renderedHeight) < 0.01 &&
          Math.abs(current.constraint - width) < 0.01
          ? previous
          : {
              ...previous,
              [id]: {
                width: renderedWidth,
                height: renderedHeight,
                constraint: width,
              },
            };
      });
    },
    [width],
  );

  /**
   * Widths again, but unwrapped. A wrapped `<Text>` reports the constraint as
   * its width, so the constrained probes above can never verify
   * `measure().width` for exactly the samples that wrap. A horizontal
   * `ScrollView` hands its child an unbounded width, nothing wraps, and
   * `onLayout` gives up the real longest line.
   */
  const [intrinsics, setIntrinsics] = useState<Record<string, number>>({});

  const onIntrinsicLayout = useCallback((id: string, rendered: number) => {
    lastLayoutAt.current = now();
    setIntrinsics(previous =>
      previous[id] !== undefined && Math.abs(previous[id]! - rendered) < 0.01
        ? previous
        : { ...previous, [id]: rendered },
    );
  }, []);

  const measuredCases = useMemo(() => {
    return SAMPLES.reduce(
      (count, sample) =>
        Math.abs((layouts[sample.id]?.constraint ?? -1) - width) < 0.01 &&
        intrinsics[sample.id] !== undefined
          ? count + 1
          : count,
      0,
    );
  }, [layouts, intrinsics, width]);

  /**
   * `FONT`'s vertical metrics, and the one claim about them worth failing on.
   *
   * Independent of the probes above and of `width` — nothing here wraps, so
   * this needs no `onLayout` to arrive and renders on the first pass. `FONT` is
   * a module constant, hence the empty dependency list.
   */
  const fontMetrics = useMemo(() => {
    const metrics = getFontMetrics(FONT);
    const inked = metrics.ascender + metrics.descender;
    const box = FONT.lineHeight;
    return {
      ...metrics,
      inked,
      /**
       * A `lineHeight` shorter than the font's own ascent plus descent is what
       * clips diacritics. Both platforms pin the line box rather than grow it —
       * `CustomLineHeightSpan` on Android, `min`/`maximumLineHeight` on iOS — so
       * what gives way is the glyph, not the box. Vacuously true with no
       * `lineHeight` set, because then nothing is pinning anything.
       */
      fits: box === undefined || inked <= box,
      /** Weak on purpose — see the note rendered under the panel. */
      ordered:
        metrics.xHeight > 0 &&
        metrics.xHeight < metrics.capHeight &&
        metrics.capHeight <= metrics.ascender,
    };
  }, []);

  const report = useMemo(() => {
    if (measuredCases < CASES) {
      return null;
    }

    const misses: Miss[] = [];
    let worst = 0;
    for (const sample of SAMPLES) {
      const rendered = layouts[sample.id]!;
      const predicted = measure(sample.text, FONT, width);
      const deltaHeight = rendered.height - predicted.height;

      // Keep this in sync with MeasuredRow: wrapped text reports the
      // constraint as its width, not the widest laid-out line.
      const widthIsComparable = rendered.width < width - TOLERANCE;
      const deltaWidth = widthIsComparable
        ? rendered.width - predicted.width
        : null;

      // Unwrapped width is always comparable, wrapped or not.
      const renderedIntrinsic = intrinsics[sample.id];
      const deltaIntrinsic =
        renderedIntrinsic === undefined
          ? null
          : renderedIntrinsic - measureWidth(sample.text, FONT);

      const matches =
        Number.isFinite(deltaHeight) &&
        Math.abs(deltaHeight) <= TOLERANCE &&
        (deltaWidth === null ||
          (Number.isFinite(deltaWidth) && Math.abs(deltaWidth) <= TOLERANCE)) &&
        (deltaIntrinsic === null ||
          (Number.isFinite(deltaIntrinsic) &&
            Math.abs(deltaIntrinsic) <= TOLERANCE));

      if (!matches) {
        misses.push({
          id: sample.id,
          kind: sample.kind,
          renderedWidth: rendered.width,
          renderedHeight: rendered.height,
          deltaWidth,
          deltaHeight,
          deltaIntrinsic,
        });
      } else {
        worst = Math.max(
          worst,
          Math.abs(deltaHeight),
          deltaWidth === null ? 0 : Math.abs(deltaWidth),
          deltaIntrinsic === null ? 0 : Math.abs(deltaIntrinsic),
        );
      }
    }

    // One pass = every case measured once. Cold clears the cache first so the
    // pass does the full amount of work; cached leaves it warm, which is what a
    // list re-rendering or scrolling back actually hits. The gap between the two
    // is what the cache buys.
    const measureAll = () => {
      for (const sample of SAMPLES) {
        measure(sample.text, FONT, width);
      }
    };
    const coldPassMs = benchmark(measureAll, clearCache);
    const cachedPassMs = benchmark(measureAll);
    // `measureBatch` is what a real list would call — one crossing for all of
    // them instead of one each — so the crossing cost is visible on its own.
    const batchPassMs = benchmark(() => {
      measureBatch(TEXTS, FONT, width);
    }, clearCache);

    // Left warm rather than cleared: the visible list is about to measure these
    // same strings again, and a cleared cache would make the app look slower
    // than it is for no reason other than that this panel ran.
    measureAll();

    return {
      misses,
      worst,
      timing: {
        coldPassMs,
        cachedPassMs,
        batchPassMs,
        // Wall time from handing the renderer 56 probes to its last answer.
        // Not a like-for-like rival to the numbers above and is not presented
        // as one: it includes mounting views, shadow-tree layout and the trip
        // back to JS. That gap is the whole reason this library exists.
        layoutMs: Math.max(0, lastLayoutAt.current - startedWaitingAt),
      },
    };
  }, [layouts, intrinsics, measuredCases, width, startedWaitingAt]);

  return (
    <View>
      {/* Laid out by the same engine as the visible list, just invisible. */}
      <View style={[styles.offscreen, { width }]} pointerEvents="none">
        {SAMPLES.map(sample => (
          <Text
            key={sample.id}
            style={[FONT, styles.probe, { maxWidth: width }]}
            allowFontScaling={false}
            onLayout={(event: LayoutChangeEvent) => {
              const { width: renderedWidth, height: renderedHeight } =
                event.nativeEvent.layout;
              onProbeLayout(sample.id, renderedWidth, renderedHeight);
            }}
          >
            {sample.text}
          </Text>
        ))}
      </View>

      {/* The same samples with no width to wrap against. */}
      <View style={styles.offscreen} pointerEvents="none">
        {SAMPLES.map(sample => (
          <ScrollView
            key={sample.id}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
          >
            <Text
              style={FONT}
              allowFontScaling={false}
              onLayout={(event: LayoutChangeEvent) => {
                onIntrinsicLayout(sample.id, event.nativeEvent.layout.width);
              }}
            >
              {sample.text}
            </Text>
          </ScrollView>
        ))}
      </View>

      <View style={styles.box}>
        <Text style={styles.title}>
          measurement accuracy · {CASES} cases @ {width.toFixed(0)}pt
        </Text>
        {report === null ? (
          <Text style={styles.line}>
            measuring… {measuredCases}/{CASES}
          </Text>
        ) : (
          <>
            <Text style={report.misses.length === 0 ? styles.ok : styles.bad}>
              {report.misses.length === 0
                ? `all ${CASES} match onLayout · worst gap ${report.worst.toFixed(
                    3,
                  )}pt`
                : `${report.misses.length}/${CASES} wrong`}
            </Text>
            {report.misses.map(miss => (
              <Text key={miss.id} style={styles.bad}>
                {miss.kind} · real {miss.renderedWidth.toFixed(2)} ×{' '}
                {miss.renderedHeight.toFixed(2)} ·{' '}
                {miss.deltaWidth === null
                  ? 'Δw n/a'
                  : `Δw ${formatDelta(miss.deltaWidth)}`}{' '}
                · Δh {formatDelta(miss.deltaHeight)} · Δwi{' '}
                {miss.deltaIntrinsic === null
                  ? '—'
                  : formatDelta(miss.deltaIntrinsic)}
              </Text>
            ))}
          </>
        )}
      </View>

      <View style={[styles.box, styles.stackedBox]}>
        <Text style={styles.title}>
          font metrics · {FONT.fontFamily} {FONT.fontSize}
        </Text>
        <Text style={styles.line}>
          ascender {fontMetrics.ascender.toFixed(2)} · descender{' '}
          {fontMetrics.descender.toFixed(2)} · lineGap{' '}
          {fontMetrics.lineGap.toFixed(2)}
        </Text>
        <Text style={styles.line}>
          capHeight {fontMetrics.capHeight.toFixed(2)} · xHeight{' '}
          {fontMetrics.xHeight.toFixed(2)} · lineHeight{' '}
          {fontMetrics.lineHeight.toFixed(2)}
        </Text>
        <Text style={fontMetrics.fits ? styles.ok : styles.bad}>
          {FONT.lineHeight === undefined
            ? `ascender + descender ${fontMetrics.inked.toFixed(2)} · no lineHeight to pin the box`
            : `ascender + descender ${fontMetrics.inked.toFixed(2)} ${
                fontMetrics.fits ? 'fits' : 'overflows'
              } lineHeight ${FONT.lineHeight.toFixed(2)}${
                fontMetrics.fits ? '' : ' · glyphs clip'
              }`}
        </Text>
        <Text style={fontMetrics.ordered ? styles.line : styles.bad}>
          {fontMetrics.ordered
            ? 'xHeight < capHeight ≤ ascender'
            : 'ordering broken · xHeight/capHeight are not heights'}
        </Text>
        <Text style={styles.note}>
          Vertical metrics, not layout: cap-height alignment, leading-trim, and
          checking that a hand-picked lineHeight actually clears the font. iOS
          reads capHeight and xHeight from the font's OS/2 table; Android
          exposes no such API and measures the ink box of "T" and "x" the way
          RN's own onTextLayout does, so expect the two platforms to differ by a
          fraction here — that gap is RN's, not this library's. The ordering
          check above is deliberately weak: for these two glyphs the advance
          width and the ink height land in the same range, which is exactly why
          returning the advance once passed for working. Comparing this panel
          between iOS and Android is the signal that actually discriminates.
        </Text>
      </View>

      {report === null ? null : (
        <View style={[styles.box, styles.stackedBox]}>
          <Text style={styles.title}>
            timing · {CASES} cases · median of {PASSES} passes
          </Text>
          <Text style={styles.line}>
            measure() ×{CASES}, cold{'  '}
            {formatMs(report.timing.coldPassMs)} ·{' '}
            {formatMs(report.timing.coldPassMs / CASES)}/case
          </Text>
          <Text style={styles.line}>
            measure() ×{CASES}, cached{'  '}
            {formatMs(report.timing.cachedPassMs)} ·{' '}
            {formatMs(report.timing.cachedPassMs / CASES)}/case
          </Text>
          <Text style={styles.line}>
            measureBatch(), cold{'  '}
            {formatMs(report.timing.batchPassMs)} ·{' '}
            {formatMs(report.timing.batchPassMs / CASES)}/case
          </Text>
          <Text style={styles.line}>
            onLayout, all {CASES} rendered{'  '}
            {formatMs(report.timing.layoutMs)}
          </Text>
          <Text style={styles.note}>
            The first three time a whole pass over every case, then divide — a
            single sub-millisecond call is the same order as the clock's own
            resolution, so timing one would report the clock. Cold clears the
            measurement cache before each pass; cached is what a re-render or a
            scroll back hits. onLayout is wall time instead: mounting views,
            laying out the shadow tree, returning to JS. It is the wait this
            library removes, not a rival to it.
          </Text>
        </View>
      )}
    </View>
  );
}

/** Same rule as `MeasuredRow`: a delta that rounds to zero prints as `0`. */
function formatDelta(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return '0';
  }
  const text = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(2);
  return rounded > 0 ? `+${text}` : text;
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', opacity: 0, top: 0, left: 0 },
  probe: { alignSelf: 'flex-start' },
  box: {
    backgroundColor: '#15181d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 3,
  },
  title: {
    color: '#f5f7fa',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  line: {
    color: '#9aa4b1',
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
  bad: {
    color: '#ff8f9a',
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
  ok: {
    color: '#6ede8a',
    fontSize: 12,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
  /** Any panel below the first one. */
  stackedBox: {
    marginTop: 8,
  },
  note: {
    color: '#6b7684',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
});
