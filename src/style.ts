import { Dimensions, Platform, type TextStyle } from 'react-native';

import type { TextSpec } from './PreText.nitro';

/**
 * The style properties that can move a line break or change a line's height.
 * Colour, decoration and alignment are left out; see the README's Known limits
 * for `textAlign: 'justify'` on Android, the one alignment that can.
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
  | 'includeFontPadding'
>;

/** The `<Text>` props that decide how the system text size applies. */
export type FontScaling = {
  /** Mirrors `<Text allowFontScaling>`; defaults to true, as on `<Text>`. */
  allowFontScaling?: boolean | undefined;
  /**
   * Mirrors `<Text maxFontSizeMultiplier>`: 1 or more caps the system text
   * scale, anything else leaves it uncapped.
   */
  maxFontSizeMultiplier?: number | undefined;
  /**
   * Replaces the system text scale with a fixed linear multiplier, for tests
   * and reproducible snapshots. Leave it out in an app: Android 14 and later
   * scale text nonlinearly, which no single multiplier reproduces.
   */
  fontScale?: number | undefined;
};

/**
 * Per-call settings: the `<Text>` props, as opposed to its style, that change
 * the layout. Each mirrors the prop of the same name and shares its default,
 * so a `<Text>` that sets none of them needs none here either.
 */
export type MeasureConfig = FontScaling & {
  /** Mirrors `numberOfLines`; omit for unlimited. */
  maxLines?: number | undefined;
  /** Android `<Text textBreakStrategy>`; RN's default is `'highQuality'`. */
  textBreakStrategy?: 'simple' | 'highQuality' | 'balanced' | undefined;
  /** Android `<Text android_hyphenationFrequency>`. */
  android_hyphenationFrequency?: 'none' | 'normal' | 'full' | undefined;
};

/** RN's own default when a `<Text>` has no `fontSize`. */
const DEFAULT_FONT_SIZE = 14;

/**
 * RN treats a NaN style number as unset (`TextAttributes::apply` keeps the
 * inherited value), so a `lineHeight` computed from an undefined font size
 * renders at the natural height. Passing NaN on would collapse the lines on
 * Android and poison the attributes on iOS. RN does apply an infinite value,
 * and what it then draws means nothing, so infinity is dropped here too rather
 * than measured.
 */
function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Drops the keys whose value is undefined. The spec's optional fields are
 * absent rather than undefined, so the object type-checks under a consumer's
 * `exactOptionalPropertyTypes` as well as under this package's own settings.
 */
function compact<T extends object>(value: {
  [K in keyof T]: T[K] | undefined;
}): T {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined) {
      result[key] = field;
    }
  }
  return result as T;
}

export function toSpec(
  style: MeasurableStyle,
  config: MeasureConfig = {},
): TextSpec {
  const fontScale = finite(config.fontScale);
  return compact<TextSpec>({
    fontFamily: style.fontFamily,
    fontSize: finite(style.fontSize) ?? DEFAULT_FONT_SIZE,
    fontWeight: style.fontWeight == null ? undefined : String(style.fontWeight),
    fontStyle: style.fontStyle,
    lineHeight: finite(style.lineHeight),
    letterSpacing: finite(style.letterSpacing),
    textTransform: style.textTransform,
    fontVariant: style.fontVariant as string[] | undefined,
    allowFontScaling: config.allowFontScaling ?? true,
    maxFontSizeMultiplier: finite(config.maxFontSizeMultiplier),
    // A zero or negative override means nothing on either platform, so it falls
    // back to the system scale on both rather than to 1 on one of them.
    fontScale:
      fontScale !== undefined && fontScale > 0 ? fontScale : systemFontScale(),
    writingDirection: style.writingDirection,
    includeFontPadding: style.includeFontPadding,
    textBreakStrategy: config.textBreakStrategy,
    hyphenationFrequency: config.android_hyphenationFrequency,
  });
}

/**
 * The scale `<Text>` will apply, for the platforms where that is one number.
 *
 * iOS: read per call, like `pixelRatio`, because the user can change text size
 * while the app runs. `Math.fround` because Fabric reads the same table through
 * `floatValue`; passing the double through would differ in the eighth digit.
 * Read from `Dimensions` directly rather than `PixelRatio.getFontScale()`,
 * which falls back to the pixel ratio (3 on most iPhones) when a custom
 * dimensions provider leaves `fontScale` out.
 *
 * Android: undefined on purpose, so native scales through RN's own SP
 * conversion, which is nonlinear from Android 14.
 */
function systemFontScale(): number | undefined {
  if (Platform.OS !== 'ios') {
    return undefined;
  }
  const fontScale = Dimensions.get('window').fontScale;
  return Math.fround(
    Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1,
  );
}
