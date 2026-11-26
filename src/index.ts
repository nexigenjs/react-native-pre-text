import { PixelRatio } from 'react-native';

import type {
  FontMetrics,
  MeasureOptions,
  TextMeasurement,
  TextSpec,
} from './PreText.nitro';
import { getModule } from './module';
import { toSpec, type FontScaling, type MeasurableStyle } from './style';

export type { FontMetrics, MeasureOptions, TextMeasurement, TextSpec };
export type { FontScaling, MeasurableStyle };

/**
 * Per-call settings. The scaling fields mirror the `<Text>` props of the same
 * name and share their defaults, so a `<Text>` that sets none of them needs
 * none here either.
 */
export type MeasureConfig = FontScaling & {
  /** Mirrors `numberOfLines`; omit for unlimited. */
  maxLines?: number;
};

function options(width: number, config?: MeasureConfig): MeasureOptions {
  return {
    maxWidth: width,
    maxLines: config?.maxLines ?? 0,
    // Read per call — it changes on a fold or an external display.
    pixelRatio: PixelRatio.get(),
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

/** Android casts the constraint to Int, so MAX_SAFE_INTEGER would overflow. */
const UNBOUNDED_WIDTH = 1_000_000;

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
  return getModule().getFontMetrics(toSpec(style, config));
}

/** Call after a font finishes loading. A system text size change needs nothing. */
export function clearCache(): void {
  getModule().clearCache();
}
