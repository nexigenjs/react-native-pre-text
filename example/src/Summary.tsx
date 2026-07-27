import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { measure } from 'react-native-pre-text';

import { SAMPLES } from './corpus';
import { FONT, TOLERANCE } from './metrics';

const CASES = SAMPLES.length;

type Miss = { kind: string; rendered: number; delta: number };

export function Summary({ width }: { width: number }) {
  const [heights, setHeights] = useState<Record<string, number>>({});

  const onProbeLayout = useCallback((id: string, height: number) => {
    setHeights(previous =>
      previous[id] !== undefined && Math.abs(previous[id]! - height) < 0.01
        ? previous
        : { ...previous, [id]: height },
    );
  }, []);

  const report = useMemo(() => {
    if (Object.keys(heights).length < CASES) {
      return null;
    }
    const misses: Miss[] = [];
    let worst = 0;
    for (const sample of SAMPLES) {
      const rendered = heights[sample.id]!;
      const delta = measure(sample.text, FONT, width).height - rendered;
      if (!Number.isFinite(delta) || Math.abs(delta) > TOLERANCE) {
        misses.push({ kind: sample.kind, rendered, delta });
      } else {
        worst = Math.max(worst, Math.abs(delta));
      }
    }
    return { misses, worst };
  }, [heights, width]);

  return (
    <View>
      {/* Laid out by the same engine as the visible list, just invisible. */}
      <View style={[styles.offscreen, { width }]} pointerEvents="none">
        {SAMPLES.map(sample => (
          <Text
            key={sample.id}
            style={[FONT, styles.probe, { maxWidth: width }]}
            allowFontScaling={false}
            onLayout={(event: LayoutChangeEvent) =>
              onProbeLayout(sample.id, event.nativeEvent.layout.height)
            }>
            {sample.text}
          </Text>
        ))}
      </View>

      <View style={styles.box}>
        <Text style={styles.title}>
          height accuracy · {CASES} cases @ {width.toFixed(0)}pt
        </Text>
        {report === null ? (
          <Text style={styles.line}>
            measuring… {Object.keys(heights).length}/{CASES}
          </Text>
        ) : (
          <>
            <Text style={report.misses.length === 0 ? styles.ok : styles.bad}>
              {report.misses.length === 0
                ? `all ${CASES} match onLayout · worst gap ${report.worst.toFixed(3)}pt`
                : `${report.misses.length}/${CASES} wrong`}
            </Text>
            {report.misses.map(miss => (
              <Text key={miss.kind} style={styles.bad}>
                {miss.kind} · real {miss.rendered.toFixed(2)} ·{' '}
                {miss.delta > 0 ? '+' : ''}
                {miss.delta.toFixed(2)}
              </Text>
            ))}
          </>
        )}
      </View>
    </View>
  );
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
});
