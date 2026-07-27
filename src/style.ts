import type { TextStyle } from 'react-native';

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

/** RN's own default when a `<Text>` has no `fontSize`. */
const DEFAULT_FONT_SIZE = 14;

export function toSpec(
  style: MeasurableStyle,
  fontScale: number | undefined,
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
    fontScale: fontScale ?? 1,
    writingDirection: style.writingDirection,
    includeFontPadding: style.includeFontPadding,
    textBreakStrategy: style.textBreakStrategy,
    hyphenationFrequency: style.android_hyphenationFrequency,
  };
}

/** Stable identity for memo keys and height caches. */
export function styleKey(
  style: MeasurableStyle,
  fontScale: number | undefined,
): string {
  const spec = toSpec(style, fontScale);
  return [
    spec.fontFamily ?? '',
    spec.fontSize,
    spec.fontWeight ?? '',
    spec.fontStyle ?? '',
    spec.lineHeight ?? '',
    spec.letterSpacing ?? '',
    spec.textTransform ?? '',
    (spec.fontVariant ?? []).join('+'),
    spec.fontScale ?? 1,
    spec.writingDirection ?? '',
    spec.includeFontPadding ?? '',
    spec.textBreakStrategy ?? '',
    spec.hyphenationFrequency ?? '',
  ].join('|');
}
