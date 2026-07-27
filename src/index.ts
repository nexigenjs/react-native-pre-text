import { PixelRatio } from 'react-native';

import type {
  FontMetrics,
  MeasureOptions,
  TextMeasurement,
  TextSpec,
} from './PreText.nitro';
import { getModule } from './module';
import { toSpec, type MeasurableStyle } from './style';

export type { FontMetrics, MeasureOptions, TextMeasurement, TextSpec };
export type { MeasurableStyle };

export type MeasureConfig = {
  /** Mirrors `numberOfLines`; omit for unlimited. */
  maxLines?: number;
  /** Dynamic Type multiplier; defaults to 1. */
  fontScale?: number;
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
    toSpec(style, config?.fontScale),
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
    toSpec(style, config?.fontScale),
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
  return getModule().getFontMetrics(toSpec(style, config?.fontScale));
}

/** Call after a font finishes loading or the system font scale changes. */
export function clearCache(): void {
  getModule().clearCache();
}
