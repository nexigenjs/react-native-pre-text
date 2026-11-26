import { PixelRatio, Platform, type TextStyle } from 'react-native';

import type { TextSpec } from './PreText.nitro';

/**
 * The subset of `<Text>` styling and props that can move a line break or
 * change a line's height. Colour, alignment and decoration cannot.
 */
export type MeasurableStyle = Pick<
  TextStyle,
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'fontStyle'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textTransform'
  | 'fontVariant'
  | 'writingDirection'
> & {
  /** Android `<Text>` prop; defaults to true there and adds to the height. */
  includeFontPadding?: boolean;
  /** Android `<Text>` prop; RN's default is `'highQuality'`. */
  textBreakStrategy?: 'simple' | 'highQuality' | 'balanced';
  /** Android `<Text>` prop. */
  android_hyphenationFrequency?: 'none' | 'normal' | 'full';
};

/** The `<Text>` props that decide how the system text size applies. */
export type FontScaling = {
  /** Mirrors `<Text allowFontScaling>`; defaults to true, as on `<Text>`. */
  allowFontScaling?: boolean;
  /**
   * Mirrors `<Text maxFontSizeMultiplier>`: 1 or more caps the system text
   * scale, anything else leaves it uncapped.
   */
  maxFontSizeMultiplier?: number;
  /**
   * Replaces the system text scale with a fixed linear multiplier, for tests
   * and reproducible snapshots. Leave it out in an app: Android 14 and later
   * scale text nonlinearly, which no single multiplier reproduces.
   */
  fontScale?: number;
};

/** RN's own default when a `<Text>` has no `fontSize`. */
const DEFAULT_FONT_SIZE = 14;

export function toSpec(
  style: MeasurableStyle,
  scaling: FontScaling = {},
): TextSpec {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize ?? DEFAULT_FONT_SIZE,
    fontWeight: style.fontWeight == null ? undefined : String(style.fontWeight),
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textTransform: style.textTransform,
    fontVariant: style.fontVariant as string[] | undefined,
    allowFontScaling: scaling.allowFontScaling ?? true,
    maxFontSizeMultiplier: scaling.maxFontSizeMultiplier,
    fontScale: scaling.fontScale ?? systemFontScale(),
    writingDirection: style.writingDirection,
    includeFontPadding: style.includeFontPadding,
    textBreakStrategy: style.textBreakStrategy,
    hyphenationFrequency: style.android_hyphenationFrequency,
  };
}

/**
 * The scale `<Text>` will apply, for the platforms where that is one number.
 *
 * iOS: read per call, like `pixelRatio`, because the user can change text size
 * while the app runs. `Math.fround` because Fabric reads the same table through
 * `floatValue`; passing the double through would differ in the eighth digit.
 *
 * Android: undefined on purpose, so native scales through RN's own SP
 * conversion, which is nonlinear from Android 14.
 */
function systemFontScale(): number | undefined {
  return Platform.OS === 'ios'
    ? Math.fround(PixelRatio.getFontScale())
    : undefined;
}
