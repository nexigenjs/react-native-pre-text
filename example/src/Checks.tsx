/**
 * Self-running checks: every font under every scaling mode, then the README's
 * use cases, each compared against what the renderer actually did.
 *
 * Nothing here needs a tap. Each step renders invisibly, waits for the
 * renderer's answer, logs one `PRETEXT {json}` line and hands over to the next,
 * so a run can be read from the device log after a cold launch at any system
 * text size. `ChecksPanel` shows the same verdicts in short.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  FlatList,
  PixelRatio,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  measure,
  measureHeights,
  measureWidth,
  type MeasurableStyle,
} from '@nexigen/react-native-pre-text';

import { SAMPLES } from './corpus';
import { FONT_OPTIONS, type FontOption } from './fonts';
import { FONT, TOLERANCE } from './metrics';
import { SCALING_MODES, type ScalingMode } from './scaling';

export type Verdict = {
  name: string;
  ok: boolean;
  summary: string;
  details?: unknown;
};

function log(payload: object) {
  console.log(`PRETEXT ${JSON.stringify(payload)}`);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

type Step =
  | { kind: 'matrix'; font: FontOption; scaling: ScalingMode }
  | { kind: 'chat' }
  | { kind: 'bubble' };

const STEPS: Step[] = [
  ...FONT_OPTIONS.flatMap(font =>
    SCALING_MODES.map(scaling => ({ kind: 'matrix' as const, font, scaling })),
  ),
  { kind: 'chat' },
  { kind: 'bubble' },
];

/**
 * Runs every step, invisibly and one at a time, and reports the verdicts so
 * far. Mount it beside the list rather than inside it: it takes no space, and
 * the chat check scrolls a FlatList of its own, which nesting would hand to
 * the outer list.
 */
export function ChecksRunner({
  width,
  onChange,
}: {
  width: number;
  onChange: (verdicts: Verdict[]) => void;
}) {
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const step = STEPS[verdicts.length];

  useEffect(() => {
    log({
      event: 'start',
      platform: Platform.OS,
      version: Platform.Version,
      fontScale: PixelRatio.getFontScale(),
      pixelRatio: PixelRatio.get(),
      width,
      steps: STEPS.length,
    });
  }, [width]);

  const onDone = useCallback((verdict: Verdict) => {
    log({ event: 'check', ...verdict });
    setVerdicts(previous => [...previous, verdict]);
  }, []);

  useEffect(() => {
    onChange(verdicts);
    if (verdicts.length === STEPS.length) {
      const failed = verdicts.filter(v => !v.ok).map(v => v.name);
      log({ event: 'done', passed: verdicts.length - failed.length, failed });
    }
  }, [verdicts, onChange]);

  return (
    <View style={[styles.offscreen, { width }]} pointerEvents="none">
      {step?.kind === 'matrix' ? (
        <ProbeSet
          key={`${step.font.id}-${step.scaling.id}`}
          font={{ ...FONT, fontFamily: step.font.fontFamily }}
          fontLabel={step.font.label}
          scaling={step.scaling}
          width={width}
          onDone={onDone}
        />
      ) : null}
      {step?.kind === 'chat' ? (
        <ChatCheck width={width} onDone={onDone} />
      ) : null}
      {step?.kind === 'bubble' ? (
        <BubbleCheck width={width} onDone={onDone} />
      ) : null}
    </View>
  );
}

/**
 * One line while the checks run and when they pass; each failure spelled out
 * underneath, since a failure is the only verdict worth the room. The full
 * record of every step is in the device log as `PRETEXT` lines.
 */
export function ChecksPanel({ verdicts }: { verdicts: Verdict[] }) {
  const failed = verdicts.filter(v => !v.ok);
  const running = verdicts.length < STEPS.length;
  return (
    <View style={styles.box}>
      <Text style={failed.length > 0 ? styles.titleBad : styles.title}>
        {running
          ? `self-checks ${verdicts.length}/${STEPS.length}…`
          : `self-checks ${verdicts.length - failed.length}/${
              STEPS.length
            } passed`}{' '}
        · text scale {PixelRatio.getFontScale().toFixed(3)}
      </Text>
      {failed.map(verdict => (
        <Text key={verdict.name} style={styles.bad}>
          {verdict.name}: {verdict.summary}
          {`\n${JSON.stringify(verdict.details)}`}
        </Text>
      ))}
    </View>
  );
}

// MARK: - Font × scaling matrix

type Rendered = { width: number; height: number };
type Lines = { count: number; last: number };

/**
 * The corpus under one font and one scaling mode. Height, width and the
 * unwrapped width are the same comparison `Summary` makes; line count and last
 * line width come from `onTextLayout` and are what "Read more" and a timestamp
 * tucked into a bubble rely on.
 */
function ProbeSet({
  font,
  fontLabel,
  scaling,
  width,
  onDone,
}: {
  font: MeasurableStyle;
  fontLabel: string;
  scaling: ScalingMode;
  width: number;
  onDone: (verdict: Verdict) => void;
}) {
  const rendered = useRef<Record<string, Rendered>>({});
  const lines = useRef<Record<string, Lines>>({});
  const intrinsics = useRef<Record<string, number>>({});
  const finished = useRef(false);

  const evaluate = useCallback(() => {
    const total = SAMPLES.length;
    if (
      finished.current ||
      Object.keys(rendered.current).length < total ||
      Object.keys(lines.current).length < total ||
      Object.keys(intrinsics.current).length < total
    ) {
      return;
    }
    finished.current = true;

    const misses: object[] = [];
    const lineMisses: object[] = [];
    const lastLineMisses: object[] = [];
    let worst = 0;

    for (const sample of SAMPLES) {
      const real = rendered.current[sample.id]!;
      const predicted = measure(sample.text, font, width, scaling.config);
      const deltaHeight = real.height - predicted.height;
      const deltaWidth =
        real.width < width - TOLERANCE ? real.width - predicted.width : null;
      const deltaIntrinsic =
        intrinsics.current[sample.id]! -
        measureWidth(sample.text, font, scaling.config);

      const gaps = [deltaHeight, deltaWidth ?? 0, deltaIntrinsic].map(Math.abs);
      if (gaps.some(gap => !(gap <= TOLERANCE))) {
        misses.push({
          id: sample.id,
          dh: round(deltaHeight),
          dw: deltaWidth === null ? null : round(deltaWidth),
          dwi: round(deltaIntrinsic),
        });
      } else {
        worst = Math.max(worst, ...gaps);
      }

      const real_lines = lines.current[sample.id]!;
      if (real_lines.count !== predicted.lineCount) {
        lineMisses.push({
          id: sample.id,
          real: real_lines.count,
          predicted: predicted.lineCount,
        });
      }
      const deltaLast = real_lines.last - predicted.lastLineWidth;
      if (!(Math.abs(deltaLast) <= TOLERANCE)) {
        lastLineMisses.push({ id: sample.id, d: round(deltaLast) });
      }
    }

    const ok = misses.length === 0 && lineMisses.length === 0;
    onDone({
      name: `${fontLabel} · ${scaling.label}`,
      ok,
      summary: `${total - misses.length}/${total} size · ${
        total - lineMisses.length
      }/${total} lines · ${
        total - lastLineMisses.length
      }/${total} last line · worst ${worst.toFixed(3)}`,
      details: {
        misses: misses.slice(0, 6),
        lineMisses: lineMisses.slice(0, 6),
        lastLineMisses: lastLineMisses.slice(0, 6),
      },
    });
  }, [font, fontLabel, scaling, width, onDone]);

  return (
    <View>
      {SAMPLES.map(sample => (
        <Text
          key={sample.id}
          {...scaling.textProps}
          style={[font, scaling.renderStyle, styles.probe, { maxWidth: width }]}
          onLayout={(event: LayoutChangeEvent) => {
            const { width: w, height: h } = event.nativeEvent.layout;
            rendered.current[sample.id] = { width: w, height: h };
            evaluate();
          }}
          onTextLayout={event => {
            const all = event.nativeEvent.lines;
            lines.current[sample.id] = {
              count: all.length,
              last: all.length > 0 ? all[all.length - 1]!.width : 0,
            };
            evaluate();
          }}
        >
          {sample.text}
        </Text>
      ))}
      {SAMPLES.map(sample => (
        <ScrollView
          key={`intrinsic-${sample.id}`}
          horizontal
          scrollEnabled={false}
        >
          <Text
            {...scaling.textProps}
            style={[font, scaling.renderStyle]}
            onLayout={(event: LayoutChangeEvent) => {
              intrinsics.current[sample.id] = event.nativeEvent.layout.width;
              evaluate();
            }}
          >
            {sample.text}
          </Text>
        </ScrollView>
      ))}
    </View>
  );
}

// MARK: - Chat list with getItemLayout

const CHAT_STYLE: MeasurableStyle = { fontSize: 16, lineHeight: 22 };
const CHAT_PAD = 8;
const CHAT_COUNT = 200;
const CHAT_TARGET = 120;

/**
 * The README's chat list, exactly: heights from `measureHeights`, offsets
 * summed into `getItemLayout`, rows pinned to that height, an inverted list.
 *
 * Checks three things. Every mounted message's `<Text>` is as tall as
 * measured, so the pinned row neither clips nor pads it. Every mounted cell
 * sits at the offset `getItemLayout` claimed, so the list's model and the real
 * layout agree. And `scrollToIndex` to a row far outside the first render lands
 * exactly on that row's offset.
 */
function ChatCheck({
  width,
  onDone,
}: {
  width: number;
  onDone: (verdict: Verdict) => void;
}) {
  const messages = useMemo(
    () =>
      Array.from({ length: CHAT_COUNT }, (_, index) => ({
        id: String(index),
        text: SAMPLES[index % SAMPLES.length]!.text,
      })),
    [],
  );

  const layout = useMemo(() => {
    let offset = 0;
    return measureHeights(
      messages.map(m => m.text),
      CHAT_STYLE,
      width,
    ).map((height, index) => {
      const length = height + CHAT_PAD * 2;
      const row = { length, offset, index };
      offset += length;
      return row;
    });
  }, [messages, width]);

  const textHeights = useRef(new Map<number, number>());
  const cellOffsets = useRef(new Map<number, number>());
  const scrollOffset = useRef<number | null>(null);
  const list = useRef<FlatList<{ id: string; text: string }>>(null);

  useEffect(() => {
    const scroll = setTimeout(() => {
      list.current?.scrollToIndex({ index: CHAT_TARGET, animated: false });
    }, 800);
    const finish = setTimeout(() => {
      const textMisses: object[] = [];
      textHeights.current.forEach((height, index) => {
        const expected = layout[index]!.length - CHAT_PAD * 2;
        if (!(Math.abs(height - expected) <= TOLERANCE)) {
          textMisses.push({ index, d: round(height - expected) });
        }
      });
      const offsetMisses: object[] = [];
      cellOffsets.current.forEach((y, index) => {
        if (!(Math.abs(y - layout[index]!.offset) <= TOLERANCE)) {
          offsetMisses.push({ index, d: round(y - layout[index]!.offset) });
        }
      });
      const expectedScroll = layout[CHAT_TARGET]!.offset;
      const landed =
        scrollOffset.current !== null &&
        Math.abs(scrollOffset.current - expectedScroll) <= TOLERANCE;
      const targetMounted = textHeights.current.has(CHAT_TARGET);

      onDone({
        name: 'chat list · getItemLayout',
        ok:
          textMisses.length === 0 &&
          offsetMisses.length === 0 &&
          landed &&
          targetMounted,
        summary: `${textHeights.current.size - textMisses.length}/${
          textHeights.current.size
        } rows · ${cellOffsets.current.size - offsetMisses.length}/${
          cellOffsets.current.size
        } offsets · scrollToIndex(${CHAT_TARGET}) ${
          landed
            ? 'landed'
            : `at ${scrollOffset.current}, want ${round(expectedScroll)}`
        }`,
        details: {
          textMisses: textMisses.slice(0, 6),
          offsetMisses: offsetMisses.slice(0, 6),
          scrollOffset: scrollOffset.current,
          expectedScroll: round(expectedScroll),
          targetMounted,
        },
      });
    }, 2000);
    return () => {
      clearTimeout(scroll);
      clearTimeout(finish);
    };
  }, [layout, onDone]);

  return (
    <CellOffsets.Provider value={cellOffsets.current}>
      <FlatList
        ref={list}
        inverted
        style={[styles.chatList, { width }]}
        data={messages}
        keyExtractor={item => item.id}
        getItemLayout={(_, index) => layout[index]!}
        CellRendererComponent={RecordingCell}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
        }}
        renderItem={({ item, index }) => (
          <View
            style={{ height: layout[index]!.length, paddingVertical: CHAT_PAD }}
          >
            <Text
              style={CHAT_STYLE}
              onLayout={(event: LayoutChangeEvent) => {
                textHeights.current.set(index, event.nativeEvent.layout.height);
              }}
            >
              {item.text}
            </Text>
          </View>
        )}
      />
    </CellOffsets.Provider>
  );
}

/** Where each mounted chat cell actually landed, keyed by index. */
const CellOffsets = createContext<Map<number, number>>(new Map());

/**
 * The list attaches no `onLayout` of its own once `getItemLayout` is set, so
 * a cell wrapper is the only place a cell's real position can be read.
 */
function RecordingCell({
  index,
  style,
  children,
}: {
  index: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const offsets = useContext(CellOffsets);
  return (
    <View
      style={style}
      onLayout={(event: LayoutChangeEvent) => {
        offsets.set(index, event.nativeEvent.layout.y);
      }}
    >
      {children}
    </View>
  );
}

// MARK: - Bubble shrunk to the measured width

/**
 * The Known limits case: give each wrapped sample a box exactly as wide as
 * `measure().width` and check the text still breaks into the same lines at the
 * same height. A different count means the narrower box moved a break.
 */
function BubbleCheck({
  width,
  onDone,
}: {
  width: number;
  onDone: (verdict: Verdict) => void;
}) {
  const font = useMemo<MeasurableStyle>(
    () => ({ ...FONT, fontFamily: FONT_OPTIONS[0]!.fontFamily }),
    [],
  );
  const cases = useMemo(
    () =>
      SAMPLES.map(sample => ({
        sample,
        predicted: measure(sample.text, font, width),
      })).filter(({ predicted }) => predicted.lineCount > 1),
    [font, width],
  );

  const results = useRef(new Map<string, { lines: number; height: number }>());
  const finished = useRef(false);

  const record = (id: string, part: { lines?: number; height?: number }) => {
    const current = results.current.get(id) ?? { lines: -1, height: -1 };
    results.current.set(id, { ...current, ...part });
    const complete = cases.every(({ sample }) => {
      const result = results.current.get(sample.id);
      return result && result.lines >= 0 && result.height >= 0;
    });
    if (!complete || finished.current) {
      return;
    }
    finished.current = true;
    const misses = cases
      .map(({ sample, predicted }) => {
        const result = results.current.get(sample.id)!;
        return {
          id: sample.id,
          lines: result.lines,
          predicted: predicted.lineCount,
          dh: round(result.height - predicted.height),
        };
      })
      .filter(
        miss =>
          miss.lines !== miss.predicted || !(Math.abs(miss.dh) <= TOLERANCE),
      );
    onDone({
      name: 'bubble · shrunk to measured width',
      ok: misses.length === 0,
      summary: `${cases.length - misses.length}/${
        cases.length
      } wrapped samples keep their lines`,
      details: { misses: misses.slice(0, 8) },
    });
  };

  return (
    <View>
      {cases.map(({ sample, predicted }) => (
        <View key={sample.id} style={{ width: predicted.width }}>
          <Text
            style={font}
            onLayout={event =>
              record(sample.id, { height: event.nativeEvent.layout.height })
            }
            onTextLayout={event =>
              record(sample.id, { lines: event.nativeEvent.lines.length })
            }
          >
            {sample.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#15181d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
  },
  title: {
    color: '#6ede8a',
    fontSize: 13,
    fontWeight: '600',
  },
  titleBad: {
    color: '#ff8f9a',
    fontSize: 13,
    fontWeight: '600',
  },
  bad: {
    color: '#ff8f9a',
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 15,
  },
  offscreen: { position: 'absolute', opacity: 0, top: 0, left: 0 },
  chatList: { height: 400 },
  probe: { alignSelf: 'flex-start' },
});
