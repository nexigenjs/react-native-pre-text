/**
 * One list row: a text sample, what `pre-text` said it would be, and what it
 * turned out to be.
 *
 *  - blue banner  — `measure()`, before React mounts anything.
 *  - amber banner — `onLayout`, read back from the rendered `<Text>`.
 *  - green banner — the two agree. Red when they do not, with the gap spelled
 *    out, because a sample nothing can predict is the interesting case.
 *
 * One thing here is easy to get wrong: the `<Text>` uses
 * `alignSelf: 'flex-start'` with `maxWidth` rather than stretching, so a
 * single-line sample reports its real intrinsic width instead of the container
 * width. Once the text wraps, though, no style can recover the longest line —
 * `RCTTextLayoutManager.mm` overwrites the width with the container's outright:
 *
 *     if (textDidWrap) { size.width = textContainer.size.width; }
 *
 * So a wrapped sample's rendered width is the constraint, and comparing it to
 * `measure().width` would compare two different quantities. The row prints
 * `Δw n/a` for those instead of a meaningless number.
 *
 * That leaves `measure().width` unverified for exactly the samples that need it
 * most, so there is a second probe: the same text inside a horizontal
 * `ScrollView`, which hands its child an unbounded width. Nothing wraps there,
 * `textDidWrap` stays false, and `onLayout` reports the genuine longest line —
 * which is what `measureWidth()` claims. Δwi is that comparison.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { measure, measureWidth } from '@nexigen/react-native-pre-text';

import type { Sample } from './corpus';
import {
  CARD_MARGIN_H,
  CARD_PADDING_H,
  FONT,
  TOLERANCE,
  formatMs,
  now,
  useRestartingClock,
} from './metrics';

type Measured = { width: number; height: number; elapsedMs: number };

type Props = {
  sample: Sample;
  index: number;
  /** Screen width minus list padding and card margin/padding. */
  availableWidth: number;
};

function MeasuredRowImpl({ sample, index, availableWidth }: Props) {
  const { predicted, predictedMs } = useMemo(() => {
    const started = now();
    const result = measure(sample.text, FONT, availableWidth);
    return { predicted: result, predictedMs: now() - started };
  }, [sample.text, availableWidth]);

  /** Natural width on one unwrapped line — what the ScrollView probe renders. */
  const { predictedIntrinsic, predictedIntrinsicMs } = useMemo(() => {
    const started = now();
    const result = measureWidth(sample.text, FONT);
    return { predictedIntrinsic: result, predictedIntrinsicMs: now() - started };
  }, [sample.text]);

  /**
   * When this row last began waiting on the renderer. Restarts with the inputs,
   * because a width change makes `onLayout` fire again and the old start would
   * turn the new latency into nonsense.
   */
  const startedWaitingAt = useRestartingClock(
    `${sample.text}|${availableWidth}`,
  );

  const [measured, setMeasured] = useState<Measured | null>(null);
  const [intrinsic, setIntrinsic] = useState<number | null>(null);

  const onIntrinsicLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setIntrinsic(previous =>
      previous !== null && Math.abs(previous - width) < 0.01 ? previous : width,
    );
  }, []);

  const onTextLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      const elapsedMs = now() - startedWaitingAt;
      // Bail out when nothing moved — onLayout fires on every re-render, and an
      // unconditional setState here would loop the row forever.
      setMeasured(previous =>
        previous &&
        Math.abs(previous.width - width) < 0.01 &&
        Math.abs(previous.height - height) < 0.01
          ? previous
          : { width, height, elapsedMs },
      );
    },
    [startedWaitingAt],
  );

  // Once the text wraps, the platform reports the constraint rather than the
  // longest line, so the rendered width stops being a measurement of the text.
  const widthIsComparable =
    measured !== null && measured.width < availableWidth - TOLERANCE;
  const deltaWidth =
    measured && widthIsComparable ? measured.width - predicted.width : null;
  const deltaHeight = measured ? measured.height - predicted.height : null;
  const deltaIntrinsic =
    intrinsic !== null ? intrinsic - predictedIntrinsic : null;

  const matches =
    deltaHeight !== null &&
    Math.abs(deltaHeight) <= TOLERANCE &&
    (deltaWidth === null || Math.abs(deltaWidth) <= TOLERANCE) &&
    (deltaIntrinsic === null || Math.abs(deltaIntrinsic) <= TOLERANCE);

  return (
    <View style={styles.card}>
      <Text style={styles.meta}>
        #{index} · {sample.kind}
      </Text>

      <Text
        style={[FONT, styles.sample, { maxWidth: availableWidth }]}
        allowFontScaling={false}
        onLayout={onTextLayout}>
        {sample.text}
      </Text>

      {/*
        A horizontal ScrollView measures its child with an unbounded width, so
        nothing wraps and `onLayout` reports the true longest line. Invisible —
        it exists only to give Δwi something real to compare against.
      */}
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.intrinsicProbe}
        pointerEvents="none">
        <Text
          style={FONT}
          allowFontScaling={false}
          onLayout={onIntrinsicLayout}>
          {sample.text}
        </Text>
      </ScrollView>

      <View style={[styles.banner, styles.bannerPredicted]}>
        <Text style={styles.bannerLabel}>
          measure({availableWidth.toFixed(1)})
        </Text>
        <Text style={styles.bannerValue}>
          {predicted.width.toFixed(2)} × {predicted.height.toFixed(2)} pt ·{' '}
          {predicted.lineCount} {predicted.lineCount === 1 ? 'line' : 'lines'} (
          {formatMs(predictedMs)})
        </Text>
      </View>

      <View style={[styles.banner, styles.bannerRendered]}>
        <Text style={[styles.bannerLabel, styles.bannerLabelRendered]}>
          onLayout (rendered)
        </Text>
        <Text style={styles.bannerValue}>
          {measured
            ? `${measured.width.toFixed(2)} × ${measured.height.toFixed(2)} pt (${formatMs(measured.elapsedMs)})`
            : 'measuring…'}
        </Text>
      </View>

      {measured ? (
        <View
          style={[
            styles.banner,
            matches ? styles.bannerMatch : styles.bannerNoMatch,
          ]}>
          <Text
            style={[
              styles.bannerLabel,
              matches ? styles.bannerLabelMatch : styles.bannerLabelNoMatch,
            ]}>
            {matches ? 'MATCHES onLayout' : 'MISMATCH'}
          </Text>
          <Text style={styles.bannerValue}>
            {deltaWidth === null
              ? 'Δw n/a — wrapped, width is the container'
              : `Δw ${formatDelta(deltaWidth)}`}{' '}
            · Δh {formatDelta(deltaHeight ?? 0)}
          </Text>
          <Text style={styles.bannerLabel}>
            intrinsic {predictedIntrinsic.toFixed(2)} (
            {formatMs(predictedIntrinsicMs)}) →{' '}
            {intrinsic === null ? 'measuring…' : intrinsic.toFixed(2)} pt · Δwi{' '}
            {deltaIntrinsic === null ? '—' : formatDelta(deltaIntrinsic)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A delta the display itself rounds away to nothing is zero — not `-0.00`.
 * Printing a sign on it reads as a real miss, which is the opposite of what
 * happened, so round first and only then decide whether a sign is warranted.
 */
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

export const MeasuredRow = memo(MeasuredRowImpl);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#15181d',
    borderRadius: 12,
    marginHorizontal: CARD_MARGIN_H,
    paddingHorizontal: CARD_PADDING_H,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  meta: {
    color: '#6b7684',
    fontSize: 11,
    fontFamily: 'Menlo',
  },
  sample: {
    color: '#e8edf3',
    alignSelf: 'flex-start',
  },
  // Laid out for real, just never seen.
  intrinsicProbe: {
    position: 'absolute',
    opacity: 0,
    top: 0,
    left: 0,
  },
  banner: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  bannerPredicted: {
    backgroundColor: '#16304d',
  },
  bannerRendered: {
    backgroundColor: '#4a3410',
  },
  bannerMatch: {
    backgroundColor: '#123c26',
  },
  bannerNoMatch: {
    backgroundColor: '#45161b',
  },
  bannerLabel: {
    color: '#9fb2c7',
    fontSize: 11,
    fontFamily: 'Menlo',
  },
  bannerLabelRendered: {
    color: '#d3ac74',
  },
  bannerLabelMatch: {
    color: '#7fd8a0',
  },
  bannerLabelNoMatch: {
    color: '#ff9aa5',
  },
  bannerValue: {
    color: '#f5f7fa',
    fontSize: 15,
    fontWeight: '600',
  },
});
