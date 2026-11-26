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
  useWindowDimensions,
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

type StyleVariant = { id: string; label: string; style: MeasurableStyle };

type Step =
  | {
      kind: 'matrix';
      font: FontOption;
      scaling: ScalingMode;
      variant?: StyleVariant;
    }
  | { kind: 'truncate'; font: FontOption; maxLines: number }
  | { kind: 'edge' }
  | { kind: 'chat' }
  | { kind: 'bubble' };

/** One line, like a preview or a name; three, like a collapsed "Read more". */
const MAX_LINES = [1, 3];

/**
 * Styles beyond the corpus's 16/24. Without a lineHeight, Android takes
 * BoringLayout's fast path and natural font metrics; a letterSpacing of 0
 * switches kerning off on iOS; real tracking runs Android's em conversion.
 */
const STYLE_VARIANTS: StyleVariant[] = [
  { id: 'natural', label: '16, no lineHeight', style: { fontSize: 16 } },
  {
    id: 'kern0',
    label: '16/24 letterSpacing 0',
    style: { fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  },
  {
    id: 'tracked',
    label: '15 letterSpacing 0.6',
    style: { fontSize: 15, letterSpacing: 0.6 },
  },
  ...(['500', '600', '900'] as const).map(fontWeight => ({
    id: `w${fontWeight}`,
    label: `16/24 weight ${fontWeight}`,
    style: { fontSize: 16, lineHeight: 24, fontWeight },
  })),
];

/**
 * iOS families with real faces at several weights, where picking the face is
 * the whole question, and the CSS generic families RN maps to system designs.
 * Android has neither, so these run on iOS only.
 */
const IOS_FONT_STEPS: Step[] =
  Platform.OS === 'ios'
    ? [
        ...['Avenir Next', 'Helvetica Neue'].flatMap(family =>
          (['400', '500', '600', '800'] as const).map(fontWeight => ({
            kind: 'matrix' as const,
            font: { id: family, label: family, group: '', fontFamily: family },
            scaling: SCALING_MODES[0]!,
            variant: {
              id: `w${fontWeight}`,
              label: `weight ${fontWeight}`,
              style: { fontSize: 16, lineHeight: 24, fontWeight },
            },
          })),
        ),
        ...['ui-monospace', 'ui-rounded', 'ui-serif'].map(family => ({
          kind: 'matrix' as const,
          font: { id: family, label: family, group: '', fontFamily: family },
          scaling: SCALING_MODES[0]!,
        })),
      ]
    : [];

const STEPS: Step[] = [
  ...FONT_OPTIONS.flatMap(font =>
    SCALING_MODES.map(scaling => ({ kind: 'matrix' as const, font, scaling })),
  ),
  ...FONT_OPTIONS.flatMap(font =>
    STYLE_VARIANTS.map(variant => ({
      kind: 'matrix' as const,
      font,
      scaling: SCALING_MODES[0]!,
      variant,
    })),
  ),
  ...IOS_FONT_STEPS,
  { kind: 'edge' },
  ...FONT_OPTIONS.flatMap(font =>
    MAX_LINES.map(maxLines => ({ kind: 'truncate' as const, font, maxLines })),
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
    // On the next tick, not inside the layout event that finished the step.
    // RN 0.88 dispatches onLayout synchronously, so the next step would mount,
    // lay out and finish inside the same update, and so on down the list,
    // until React's nested-update limit (50) aborts the run.
    setTimeout(() => setVerdicts(previous => [...previous, verdict]), 0);
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
          key={`${step.font.id}-${step.scaling.id}-${step.variant?.id ?? ''}`}
          font={{
            ...(step.variant?.style ?? FONT),
            fontFamily: step.font.fontFamily,
          }}
          fontLabel={
            step.variant
              ? `${step.font.label} · ${step.variant.label}`
              : step.font.label
          }
          scaling={step.scaling}
          width={width}
          onDone={onDone}
        />
      ) : null}
      {step?.kind === 'edge' ? <EdgeSet width={width} onDone={onDone} /> : null}
      {step?.kind === 'truncate' ? (
        <TruncateSet
          key={`${step.font.id}-${step.maxLines}`}
          font={{ ...FONT, fontFamily: step.font.fontFamily }}
          fontLabel={step.font.label}
          maxLines={step.maxLines}
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

// MARK: - Edge cases

const EDGE_TEXTS = [
  { id: 'empty', text: '' },
  { id: 'space', text: ' ' },
  { id: 'newline', text: '\n' },
  { id: 'trailing-newline', text: 'Hello\n' },
  { id: 'two-lines-trailing-newline', text: 'Hello\nWorld\n' },
  { id: 'double-trailing-newline', text: 'Hello\n\n' },
  {
    id: 'long-word',
    text: 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3),
  },
  // Short single lines in scripts drawn from fallback fonts: without a
  // lineHeight these take Android's BoringLayout path and its fallback spacing.
  { id: 'cjk', text: '好的，明天见' },
  { id: 'japanese', text: 'ありがとう' },
  { id: 'thai', text: 'สวัสดีครับ' },
  { id: 'devanagari', text: 'नमस्ते दोस्त' },
];
const EDGE_LIMITS = [0, 1, 2];
/**
 * No fontFamily on any of these: the default font, and on Android no font
 * selector, which decides whether RN applies a fontVariant at all.
 */
const EDGE_STYLES: { id: string; style: MeasurableStyle }[] = [
  { id: '16/24', style: { fontSize: 16, lineHeight: 24 } },
  { id: '16', style: { fontSize: 16 } },
  { id: 'small-caps', style: { fontSize: 16, fontVariant: ['small-caps'] } },
];
/** None of these is a limit, so each must match the unlimited measurement. */
const NOT_A_LIMIT = [Infinity, NaN, -1, 0.5];

/**
 * The inputs the corpus has none of: nothing at all, only whitespace, text
 * ending in a newline, a word wider than the box, each with and without a
 * line limit. Then every value `maxLines` should treat as "no limit", which
 * must neither crash nor change the answer.
 */
function EdgeSet({
  width,
  onDone,
}: {
  width: number;
  onDone: (verdict: Verdict) => void;
}) {
  const cases = useMemo(
    () =>
      EDGE_STYLES.flatMap(({ id: styleId, style }) =>
        EDGE_TEXTS.flatMap(sample =>
          EDGE_LIMITS.map(limit => ({
            key: `${styleId}/${sample.id}/${limit}`,
            style,
            text: sample.text,
            limit,
          })),
        ),
      ),
    [],
  );
  const font = EDGE_STYLES[0]!.style;
  const rendered = useRef<Record<string, Rendered>>({});
  const lines = useRef<Record<string, number>>({});
  const finished = useRef(false);

  const evaluate = useCallback(() => {
    if (
      finished.current ||
      Object.keys(rendered.current).length < cases.length ||
      Object.keys(lines.current).length < cases.length
    ) {
      return;
    }
    finished.current = true;

    const misses: object[] = [];
    const lineMisses: object[] = [];
    for (const { key, style, text, limit } of cases) {
      const real = rendered.current[key]!;
      const predicted = measure(text, style, width, { maxLines: limit });
      const deltaHeight = real.height - predicted.height;
      const deltaWidth =
        real.width < width - TOLERANCE ? real.width - predicted.width : null;
      if (
        !(Math.abs(deltaHeight) <= TOLERANCE) ||
        (deltaWidth !== null && !(Math.abs(deltaWidth) <= TOLERANCE))
      ) {
        misses.push({
          key,
          dh: round(deltaHeight),
          dw: deltaWidth === null ? null : round(deltaWidth),
        });
      }
      if (lines.current[key] !== predicted.lineCount) {
        lineMisses.push({
          key,
          real: lines.current[key],
          predicted: predicted.lineCount,
        });
      }
    }

    const limitMisses: object[] = [];
    for (const { id, text } of EDGE_TEXTS) {
      const unlimited = measure(text, font, width);
      for (const maxLines of NOT_A_LIMIT) {
        const result = measure(text, font, width, { maxLines });
        if (
          result.height !== unlimited.height ||
          result.lineCount !== unlimited.lineCount
        ) {
          limitMisses.push({ id, maxLines: String(maxLines) });
        }
      }
    }

    onDone({
      name: 'edge cases',
      ok:
        misses.length === 0 &&
        lineMisses.length === 0 &&
        limitMisses.length === 0,
      summary: `${cases.length - misses.length}/${cases.length} size · ${
        cases.length - lineMisses.length
      }/${cases.length} lines · ${
        EDGE_TEXTS.length * NOT_A_LIMIT.length - limitMisses.length
      }/${EDGE_TEXTS.length * NOT_A_LIMIT.length} non-limits ignored`,
      details: {
        misses: misses.slice(0, 8),
        lineMisses: lineMisses.slice(0, 8),
        limitMisses: limitMisses.slice(0, 8),
      },
    });
  }, [cases, font, width, onDone]);

  return (
    <View>
      {cases.map(({ key, style, text, limit }) => (
        <Text
          key={key}
          numberOfLines={limit || undefined}
          style={[style, styles.probe, { maxWidth: width }]}
          onLayout={(event: LayoutChangeEvent) => {
            const { width: w, height: h } = event.nativeEvent.layout;
            rendered.current[key] = { width: w, height: h };
            evaluate();
          }}
          onTextLayout={event => {
            lines.current[key] = event.nativeEvent.lines.length;
            evaluate();
          }}
        >
          {text}
        </Text>
      ))}
    </View>
  );
}

// MARK: - maxLines against numberOfLines

/**
 * `measure(..., { maxLines })` against `<Text numberOfLines>`: the clamped
 * height, the lines left showing, and `didTruncate`. Whether a sample really
 * was cut is decided by the unclamped measurement, whose line count the
 * matrix above has already checked against the renderer.
 */
function TruncateSet({
  font,
  fontLabel,
  maxLines,
  width,
  onDone,
}: {
  font: MeasurableStyle;
  fontLabel: string;
  maxLines: number;
  width: number;
  onDone: (verdict: Verdict) => void;
}) {
  const rendered = useRef<Record<string, Rendered>>({});
  const lines = useRef<Record<string, number>>({});
  const finished = useRef(false);

  const evaluate = useCallback(() => {
    const total = SAMPLES.length;
    if (
      finished.current ||
      Object.keys(rendered.current).length < total ||
      Object.keys(lines.current).length < total
    ) {
      return;
    }
    finished.current = true;

    const misses: object[] = [];
    const lineMisses: object[] = [];
    const truncationMisses: object[] = [];
    let cut = 0;
    let worst = 0;

    for (const sample of SAMPLES) {
      const real = rendered.current[sample.id]!;
      const predicted = measure(sample.text, font, width, { maxLines });
      const truncated = measure(sample.text, font, width).lineCount > maxLines;
      if (truncated) {
        cut += 1;
      }

      const deltaHeight = real.height - predicted.height;
      const deltaWidth =
        real.width < width - TOLERANCE ? real.width - predicted.width : null;
      const gaps = [deltaHeight, deltaWidth ?? 0].map(Math.abs);
      if (gaps.some(gap => !(gap <= TOLERANCE))) {
        misses.push({
          id: sample.id,
          dh: round(deltaHeight),
          dw: deltaWidth === null ? null : round(deltaWidth),
        });
      } else {
        worst = Math.max(worst, ...gaps);
      }

      if (lines.current[sample.id] !== predicted.lineCount) {
        lineMisses.push({
          id: sample.id,
          real: lines.current[sample.id],
          predicted: predicted.lineCount,
        });
      }
      if (predicted.didTruncate !== truncated) {
        truncationMisses.push({
          id: sample.id,
          didTruncate: predicted.didTruncate,
          expected: truncated,
        });
      }
    }

    onDone({
      name: `${fontLabel} · maxLines ${maxLines}`,
      ok:
        misses.length === 0 &&
        lineMisses.length === 0 &&
        truncationMisses.length === 0,
      summary: `${total - misses.length}/${total} size · ${
        total - lineMisses.length
      }/${total} lines · ${
        total - truncationMisses.length
      }/${total} didTruncate (${cut} cut) · worst ${worst.toFixed(3)}`,
      details: {
        misses: misses.slice(0, 6),
        lineMisses: lineMisses.slice(0, 6),
        truncationMisses: truncationMisses.slice(0, 6),
      },
    });
  }, [font, fontLabel, maxLines, width, onDone]);

  return (
    <View>
      {SAMPLES.map(sample => (
        <Text
          key={sample.id}
          numberOfLines={maxLines}
          style={[font, styles.probe, { maxWidth: width }]}
          onLayout={(event: LayoutChangeEvent) => {
            const { width: w, height: h } = event.nativeEvent.layout;
            rendered.current[sample.id] = { width: w, height: h };
            evaluate();
          }}
          onTextLayout={event => {
            lines.current[sample.id] = event.nativeEvent.lines.length;
            evaluate();
          }}
        >
          {sample.text}
        </Text>
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
  const { fontScale } = useWindowDimensions();
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
    // measureHeights reads the text scale itself; listing it recomputes the
    // layout when the user changes their text size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, width, fontScale]);

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
