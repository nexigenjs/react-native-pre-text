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
 * width. Once the text wraps, though, the platform reports the constraint
 * itself — so for multi-line samples only the height comparison carries
 * information, and the row says so rather than printing a meaningless Δw.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { measure } from 'react-native-pre-text';

import type { Sample } from './corpus';
import { CARD_MARGIN_H, CARD_PADDING_H, FONT, TOLERANCE } from './metrics';

type Measured = { width: number; height: number };

type Props = {
  sample: Sample;
  index: number;
  /** Screen width minus list padding and card margin/padding. */
  availableWidth: number;
};

function MeasuredRowImpl({ sample, index, availableWidth }: Props) {
  const predicted = useMemo(
    () => measure(sample.text, FONT, availableWidth),
    [sample.text, availableWidth],
  );

  const [measured, setMeasured] = useState<Measured | null>(null);

  const onTextLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // Bail out when nothing moved — onLayout fires on every re-render, and an
    // unconditional setState here would loop the row forever.
    setMeasured(previous =>
      previous &&
      Math.abs(previous.width - width) < 0.01 &&
      Math.abs(previous.height - height) < 0.01
        ? previous
        : { width, height },
    );
  }, []);

  // Once the text wraps, the platform reports the constraint rather than the
  // longest line, so the rendered width stops being a measurement of the text.
  const widthIsComparable =
    measured !== null && measured.width < availableWidth - TOLERANCE;
  const deltaWidth =
    measured && widthIsComparable ? measured.width - predicted.width : null;
  const deltaHeight = measured ? measured.height - predicted.height : null;

  const matches =
    deltaHeight !== null &&
    Math.abs(deltaHeight) <= TOLERANCE &&
    (deltaWidth === null || Math.abs(deltaWidth) <= TOLERANCE);

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

      <View style={[styles.banner, styles.bannerPredicted]}>
        <Text style={styles.bannerLabel}>
          measure({availableWidth.toFixed(1)})
        </Text>
        <Text style={styles.bannerValue}>
          {predicted.width.toFixed(2)} × {predicted.height.toFixed(2)} pt ·{' '}
          {predicted.lineCount} {predicted.lineCount === 1 ? 'line' : 'lines'}
        </Text>
      </View>

      <View style={[styles.banner, styles.bannerRendered]}>
        <Text style={[styles.bannerLabel, styles.bannerLabelRendered]}>
          onLayout (rendered)
        </Text>
        <Text style={styles.bannerValue}>
          {measured
            ? `${measured.width.toFixed(2)} × ${measured.height.toFixed(2)} pt`
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
            {matches ? 'ЗБІГ з onLayout' : 'РОЗБІЖНІСТЬ'}
          </Text>
          <Text style={styles.bannerValue}>
            {deltaWidth === null
              ? 'Δw n/a — wrapped, width is the container'
              : `Δw ${formatDelta(deltaWidth)}`}{' '}
            · Δh {formatDelta(deltaHeight ?? 0)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function formatDelta(value: number): string {
  const text = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
  return value > 0 ? `+${text}` : text;
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
