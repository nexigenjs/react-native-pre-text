# How it stays accurate

## The renderer, answering early

Both platforms measure with the engine that will draw the text: iOS TextKit and
Android `StaticLayout`. This is not a model of the renderer, it is the renderer
answering early. Unicode line breaking, kinsoku, bidi and Thai dictionary
breaking all come for free, because they are the same code paths `<Text>` uses.

## The same engine is not enough

Measuring with the same engine is necessary but not sufficient. Everything
React Native does between the engine and `onLayout` has to be repeated too, and
the library repeats it line for line rather than approximating it:

- **Pixel rounding.** React Native rounds a text size up to the next whole
  device pixel before Yoga sees it: `ceil(size * pointScaleFactor) /
  pointScaleFactor` in `RCTTextLayoutManager.mm`. TextKit's raw value lands
  short of `onLayout` by up to a pixel, always short and never over. iOS applies
  the same step (React Native 0.88 nudges by 0.001 first, and so does the
  library there); Android lays out in whole physical pixels at React Native's own
  screen density.
- **Font resolution.** On iOS a family resolves through
  `UIFont.fontNames(forFamilyName:)` and the face whose weight, read from its
  name, is closest to the one asked for, as `RCTFontWithFontProperties` does. On
  Android it goes through React Native's `ReactFontManager`, so a font in
  `assets/fonts/` resolves as it does on screen.
- **Line height.** Android's `lineHeight` is a port of React Native's
  `CustomLineHeightSpan`; iOS pins minimum and maximum line height as React
  Native does.
- **Text size.** Dynamic Type and Android's nonlinear SP scaling, as on
  [System text size](./text-size).
- **Edge cases.** An empty string, a text ending in a newline under
  `numberOfLines`, `letterSpacing: 0` (which switches kerning off on iOS), the
  fallback-font line spacing of short single lines on Android 13 and later: each
  measured as React Native lays it out.

## Checked against `onLayout`

The repository's `example/` app checks every measurement against the rendered
`<Text>`, by itself, at launch. It needs no taps, so it can be relaunched at
each system text size; each check writes one `PRETEXT {json}` line to the
device log and its verdict to the screen. The checks are:

- **A 65-case corpus of real content** in every bundled font (the system font,
  Inter, Lora, Fira Code and Noto Sans) under three scaling modes: the system
  text size, `allowFontScaling={false}` and `maxFontSizeMultiplier`. The corpus
  has doubled spaces, tabs, newlines, curly quotes, em dashes, non-breaking
  spaces from a paste, prices, ratings, @handles, URLs, addresses, CJK, Thai,
  Arabic, Hebrew, Devanagari, Vietnamese, and emoji down to keycaps, ZWJ
  families, skin tones and tag-sequence flags.
- **More styles** in every font: no `lineHeight`, `letterSpacing: 0`, real
  tracking, weights 500, 600 and 900. On iOS also Avenir Next and Helvetica Neue
  at four weights, and `ui-monospace`, `ui-rounded` and `ui-serif`.
- **`maxLines` 1 and 3** against `numberOfLines`.
- **Edge cases**: empty and whitespace-only strings, trailing newlines, a word
  wider than the box, short single lines of Chinese, Japanese, Thai and
  Devanagari, and `maxLines` values that are not a limit.
- **The chat list** with `getItemLayout` and `scrollToIndex`, and a bubble
  shrunk to its measured width.

Each case is checked three ways: height against `onLayout`, width against
`onLayout` where the text fits on one line, and width against an unwrapped
render. The third exists because a wrapped `<Text>` cannot report its own
longest line; React Native overwrites it with the container's width.

A check fails on a gap of half a point or more, so "match" means within one
physical pixel at these densities.

## Current results

React Native 0.86:

| Device | Width | Text sizes | Checks |
|---|---|---|---|
| iPhone 17 Pro simulator, iOS 26.2 | 326 pt | 1.0, 1.235, 2.143 | 69 of 69 at every size |
| Pixel 7 emulator, Android 16 | 335 dp | 1.0, 1.3, 2.0 | 58 of 58; 57 at 2.0 |

The one failure is expected: at Android's 2.0 scale, one Korean sample shrunk
to its measured width breaks into fewer lines (see
[Known limits](./known-limits)). On React Native 0.88, Android also passes with
the "Bold text" accessibility setting on. iOS on 0.88 has not been run on a
device; its pixel rounding is implemented from React Native's source.

CI runs the same checks on an Android API 34 emulator at three text sizes for
every pull request, so a React Native release that changes its text code
underneath the library shows up as a failing check.

Run `example/` on the devices you support to validate the corpus, widths and
fonts there.
