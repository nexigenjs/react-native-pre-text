import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Everything about a `<Text>` that can change where its lines break or how
 * tall they are.
 *
 * This mirrors React Native's own props rather than inventing a font type,
 * because the module's whole contract is "tell me what this exact `<Text>`
 * will render as". A descriptor that carried less than `<Text>` accepts could
 * only ever be right by accident: `textTransform` changes the glyphs,
 * `fontVariant` changes their advances, and on Android `includeFontPadding`
 * and `textBreakStrategy` change the height and the break points outright.
 *
 * Enum-ish fields are plain strings holding React Native's own values, so a
 * style object can be forwarded without translation. Unknown values fall back
 * to the platform default rather than throwing — a typo should not crash a
 * list.
 */
export interface TextSpec {
  /** Omit for the system font, exactly like `<Text>`. */
  fontFamily?: string;
  fontSize: number;
  /** `'normal' | 'bold' | '100'…'900'`. */
  fontWeight?: string;
  /** `'normal' | 'italic'`. */
  fontStyle?: string;
  /** Omit to use the font's natural leading. */
  lineHeight?: number;
  /** Points, matching RN: added after every glyph except the line's last. */
  letterSpacing?: number;
  /** `'none' | 'uppercase' | 'lowercase' | 'capitalize'` — applied before measuring. */
  textTransform?: string;
  /** e.g. `['tabular-nums']` — changes advances, so it changes wrapping. */
  fontVariant?: string[];
  /**
   * Mirrors `<Text allowFontScaling>`, and like it defaults to true. False
   * measures at the style's own size whatever the system text size is.
   */
  allowFontScaling?: boolean;
  /**
   * Mirrors `<Text maxFontSizeMultiplier>`. A value of 1 or more caps the
   * system text scale; anything else, including leaving it out, leaves it
   * uncapped, which is RN's own rule.
   */
  maxFontSizeMultiplier?: number;
  /**
   * The text scale as a plain multiplier, applied before the cap above.
   *
   * iOS: the JS layer passes `Dimensions.get('window').fontScale`, which reads
   * the same content-size table RN's renderer uses. Without it nothing is
   * scaled.
   *
   * Android: leave it out and the platform scales the way `<Text>` does,
   * through `TypedValue.applyDimension(COMPLEX_UNIT_SP)`. That is nonlinear
   * from Android 14 — large sizes grow less than small ones — so no single
   * multiplier reproduces it. A value here overrides the system with a fixed
   * linear scale.
   */
  fontScale?: number;
  /** `'auto' | 'ltr' | 'rtl'`. */
  writingDirection?: string;

  // --- Android only; ignored on iOS ---------------------------------------
  /** RN defaults this to true, and it adds to the measured height. */
  includeFontPadding?: boolean;
  /** `'simple' | 'highQuality' | 'balanced'`. RN's `<Text>` default is `highQuality`. */
  textBreakStrategy?: string;
  /** `'none' | 'normal' | 'full'`. */
  hyphenationFrequency?: string;
}

export interface MeasureOptions {
  /** The width the text has to fit into, in points. */
  maxWidth: number;
  /** Mirrors `numberOfLines`; omit or pass 0 for unlimited. */
  maxLines?: number;
  /**
   * `PixelRatio.get()`. Read on iOS only.
   *
   * iOS needs it because React Native rounds a text size *up* to the next whole
   * device pixel before Yoga sees it — `ceil(size * pointScaleFactor) /
   * pointScaleFactor`. Returning TextKit's raw fractional value lands short of
   * `onLayout` by up to one pixel, so the same step is applied here.
   *
   * Android ignores it. Its text engine works in physical pixels, and the
   * native side converts dp in and back out with RN's own screen density
   * (`PixelUtil`), the one the renderer uses. JS's ratio is the window's, which
   * differs on an external display or under a density override.
   */
  pixelRatio?: number;
  /**
   * iOS only. RN 0.88 adds this (0.001) before rounding a text size up to the
   * pixel grid, so an exactly on-grid height goes up one pixel there. 0, or
   * left out, for the RN versions that round without it.
   */
  roundingEpsilon?: number;
}

export interface TextMeasurement {
  /** Widest laid-out line — not the container width. */
  width: number;
  /** What `onLayout` will report. */
  height: number;
  lineCount: number;
  /** Useful for placing a trailing element, e.g. a timestamp in a bubble. */
  lastLineWidth: number;
  /** True when `maxLines` cut the text short. */
  didTruncate: boolean;
}

export interface FontMetrics {
  /** Distance above the baseline, positive. */
  ascender: number;
  /** Distance below the baseline, positive on both platforms. */
  descender: number;
  xHeight: number;
  capHeight: number;
  lineGap: number;
  /**
   * The font's own line height, or the spec's `lineHeight` when it sets one.
   * The JS `getFontMetrics()` replaces this with the laid-out height of one
   * line of text in the spec, padding and pixel rounding included.
   */
  lineHeight: number;
}

/**
 * Native text measurement.
 *
 * Both platforms measure with the same engine that will render the text — iOS
 * TextKit, Android `StaticLayout` — so a measurement is not a prediction of
 * the renderer, it is the renderer answering early. That is deliberate: an
 * independent line-breaking implementation would have to re-derive UAX #14,
 * kinsoku, bidi and Thai dictionary breaking, and would still disagree with
 * the thing actually drawing the pixels.
 */
export interface PreText
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  measure(
    text: string,
    spec: TextSpec,
    options: MeasureOptions,
  ): TextMeasurement;

  /** Same as `measure` per item, but pays the crossing cost once. */
  measureBatch(
    texts: string[],
    spec: TextSpec,
    options: MeasureOptions,
  ): TextMeasurement[];

  getFontMetrics(spec: TextSpec): FontMetrics;

  /**
   * Drops the resolved fonts and every cached measurement.
   *
   * Call after a font finishes loading: that changes what the same inputs
   * would measure to, and a cache keyed on those inputs cannot see it happen.
   * Nothing else invalidates. The key already covers every field the platform
   * reads, including the resolved text scale, so a different style, width or
   * system text size is a different entry rather than a stale one.
   */
  clearCache(): void;
}
