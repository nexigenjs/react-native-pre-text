/**
 * Single source of truth for everything the comparison depends on.
 *
 * `FONT` is a plain React Native text style: the same object is spread into
 * the rendered `<Text>` and handed to `measure()`. There is no separate
 * measurement font to keep in sync any more — that duplication was itself a
 * bug waiting to happen.
 *
 * The horizontal chrome is declared here too, so the width fed into `measure()`
 * is derived from the same numbers the stylesheet uses instead of being a
 * hardcoded guess.
 */

import { useRef } from 'react';
import type { MeasurableStyle } from '@nexigen/react-native-pre-text';

export const FONT: MeasurableStyle = {
  fontSize: 16,
  lineHeight: 24,
};

/** `contentContainerStyle.paddingHorizontal` on the FlatList. */
export const LIST_PADDING_H = 16;
/** `marginHorizontal` on each card. */
export const CARD_MARGIN_H = 8;
/** `paddingHorizontal` on each card. */
export const CARD_PADDING_H = 14;

/** Everything between the screen edge and the text box, both sides summed. */
export const HORIZONTAL_CHROME =
  2 * (LIST_PADDING_H + CARD_MARGIN_H + CARD_PADDING_H);

/**
 * Width available to the text itself — screen width minus the list's padding
 * and the card's margins and padding. This is what gets passed down to each
 * row and into `measure()`.
 */
export function textWidthFor(screenWidth: number): number {
  return screenWidth - HORIZONTAL_CHROME;
}

/** Below this, a predicted/rendered gap is sub-pixel rounding, not an error. */
export const TOLERANCE = 0.5;

/**
 * Monotonic clock in milliseconds, for the timing panel.
 *
 * Hermes exposes `performance.now`, but falling back keeps the example running
 * on a runtime that does not — a missing timer should not take the whole
 * accuracy harness down with it.
 */
export function now(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * A timestamp that restarts whenever `key` changes.
 *
 * `useMemo(() => now(), [key])` would express the same thing, but the closure
 * never reads `key`, so `exhaustive-deps` calls the dependency unnecessary and
 * is within its rights to — the restart is intent, not data flow. Comparing the
 * key by hand states the intent instead of arguing with the rule.
 */
export function useRestartingClock(key: unknown): number {
  const ref = useRef({ key, at: now() });
  if (ref.current.key !== key) {
    ref.current = { key, at: now() };
  }
  return ref.current.at;
}

/** Sub-millisecond values are the norm here, so three decimals or it reads 0. */
export function formatMs(value: number): string {
  return value >= 100
    ? `${value.toFixed(0)} ms`
    : value >= 1
    ? `${value.toFixed(2)} ms`
    : `${value.toFixed(3)} ms`;
}
