# Upgrading to 1.0

0.1 measured at a text scale of 1 unless told otherwise; `<Text>` does not. What
changes:

- **React Native 0.85 or later** is supported and tested. Older apps stay on
  0.1.
- **`{ fontScale: PixelRatio.getFontScale() }`**, which the 0.1 README
  suggested. Remove it. It now forces the fixed linear override, which on
  Android 14 and later does not match how the system scales text.
- **No config for a `<Text>` with `allowFontScaling={false}`.** That used to
  measure unscaled by default. Pass `{ allowFontScaling: false }`, the same as
  the `<Text>`. If one shared component sets it for all your text, see
  [System text size](./text-size#a-text-component-that-turns-scaling-off).
- **`getFontMetrics()` follows the system text size** too, unless the config
  says `allowFontScaling: false`.
- **`getFontMetrics().descender` is positive on iOS.** It was UIKit's negative
  offset; it is now a distance below the baseline, as on Android, so
  `ascender + descender` is the font's height on both platforms.
- **`getFontMetrics().lineHeight` is the laid-out height of one line** of text
  in the style, `lineHeight`, font padding and pixel rounding included, rather
  than the font's nominal line height.
- **`textBreakStrategy` and `android_hyphenationFrequency` moved to the
  config.** They are `<Text>` props, not style, like the scaling props beside
  them. Pass them as the last argument instead of in the style.
- **`MeasureOptions` and `TextSpec` are no longer exported.** They were the
  native boundary's own types and no public function took them.

Measurements also change where 0.1 disagreed with the screen: weights of named
families on iOS, `letterSpacing: 0` on iOS, `didTruncate` on both platforms,
line heights at large text sizes on Android, and single short lines in
fallback-font scripts on Android 13 and later. Those are fixes; if your layout
compensated for one of them, drop the compensation.
