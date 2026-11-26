import { PixelRatio, Platform } from 'react-native';

import type {
  FontMetrics,
  MeasureOptions,
  TextMeasurement,
} from './PreText.nitro';
import { getModule } from './module';
import {
  toSpec,
  type FontScaling,
  type MeasurableStyle,
  type MeasureConfig,
} from './style';

export type { FontMetrics, TextMeasurement };
export type { FontScaling, MeasurableStyle, MeasureConfig };

/** Android casts the constraint to Int, so MAX_SAFE_INTEGER would overflow. */
const UNBOUNDED_WIDTH = 1_000_000;

/**
 * RN 0.88 iOS adds 0.001 before rounding a text size up to the pixel grid
 * (`TextMeasurementRounding.h`); earlier releases do not. Read once: the RN in
 * the process cannot change.
 */
const ROUNDING_EPSILON = (() => {
  const version = Platform.constants?.reactNativeVersion;
  return Platform.OS === 'ios' &&
    version !== undefined &&
    (version.major > 0 || version.minor >= 88)
    ? 0.001
    : 0;
})();

/**
 * `numberOfLines` semantics: a positive whole number limits, anything else
 * (0, negative, NaN, Infinity) means no limit. Fractions round down, as RN's
 * int conversion does. Clamped so no platform's integer conversion can trap.
 */
function lineLimit(maxLines: number | undefined): number {
  if (maxLines === undefined || !Number.isFinite(maxLines) || maxLines < 1) {
    return 0;
  }
  return Math.min(Math.floor(maxLines), 2_147_483_647);
}

/**
 * A width that is not a number (a container not laid out yet) or is infinite
 * means no constraint, as an unset `maxWidth` does to Yoga. A negative one
 * leaves no room at all.
 */
function boxWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(0, width) : UNBOUNDED_WIDTH;
}

function options(width: number, config?: MeasureConfig): MeasureOptions {
  return {
    maxWidth: boxWidth(width),
    maxLines: lineLimit(config?.maxLines),
    // iOS rounds to this pixel grid; read per call because it changes on an
    // external display. Android converts with RN's own screen density instead.
    pixelRatio: PixelRatio.get(),
    roundingEpsilon: ROUNDING_EPSILON,
  };
}

export function measure(
  text: string,
  style: MeasurableStyle,
  width: number,
  config?: MeasureConfig,
): TextMeasurement {
  return getModule().measure(
    text,
    toSpec(style, config),
    options(width, config),
  );
}

/** The number `onLayout` will report. */
export function measureHeight(
  text: string,
  style: MeasurableStyle,
  width: number,
  config?: MeasureConfig,
): number {
  return measure(text, style, width, config).height;
}

/** Crosses into native once for the whole list. */
export function measureBatch(
  texts: string[],
  style: MeasurableStyle,
  width: number,
  config?: MeasureConfig,
): TextMeasurement[] {
  return getModule().measureBatch(
    texts,
    toSpec(style, config),
    options(width, config),
  );
}

export function measureHeights(
  texts: string[],
  style: MeasurableStyle,
  width: number,
  config?: MeasureConfig,
): number[] {
  return measureBatch(texts, style, width, config).map(m => m.height);
}

/** Natural width on a single unwrapped line. */
export function measureWidth(
  text: string,
  style: MeasurableStyle,
  config?: MeasureConfig,
): number {
  return measure(text, style, UNBOUNDED_WIDTH, config).width;
}

export function getFontMetrics(
  style: MeasurableStyle,
  config?: MeasureConfig,
): FontMetrics {
  const metrics = getModule().getFontMetrics(toSpec(style, config));
  // The height of one line is a layout, not a font property: font padding,
  // the lineHeight span and pixel rounding all shape it. One line of text in
  // this style is that layout, on both platforms, so take it from there. (An
  // empty string would not do: Android lays one out without the lineHeight.)
  return {
    ...metrics,
    lineHeight: measure('I', style, UNBOUNDED_WIDTH, config).height,
  };
}

/** Call after a font finishes loading. A system text size change needs nothing. */
export function clearCache(): void {
  getModule().clearCache();
}
