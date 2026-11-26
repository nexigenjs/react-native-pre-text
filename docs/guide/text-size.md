# System text size

`<Text>` follows the system text size unless told otherwise, and so does
`measure()`: both default to `allowFontScaling: true` and read the current scale
themselves. A `<Text>` that sets no scaling props needs none here. One that does
gets the same values:

```tsx
<Text style={STYLE} maxFontSizeMultiplier={1.5}>{text}</Text>;

measureHeight(text, STYLE, width, { maxFontSizeMultiplier: 1.5 });
```

## A text component that turns scaling off

Many apps render all their text through one shared wrapper around `<Text>`
that changes these defaults, for example by turning `allowFontScaling` off.
Measure with the same setting:

```ts
measureHeight(text, STYLE, width, { allowFontScaling: false });
```

Skipping this is the quiet failure: a `<Text>` that does not scale, measured as
one that does, is right at the default text size and wrong at every other.
Nothing errors, and a chat starts jumping only for the users who changed their
text size. A small wrapper of your own that adds the setting to every call
keeps it from being forgotten.

## How each platform scales

Each platform scales the way its renderer does, and the library repeats that
rather than approximating it:

- **iOS** multiplies the font size and the line height by the content-size
  multiplier and leaves `letterSpacing` alone, as
  `RCTEffectiveFontSizeMultiplierFromTextAttributes` does. A
  `maxFontSizeMultiplier` of 1 or more caps the multiplier.
- **Android** converts through React Native's own `PixelUtil.toPixelFromSP`,
  then rounds the font up to a whole pixel, as `TextAttributeProps` does. From
  Android 14 that conversion is nonlinear, so large text grows less than small
  text, and no single multiplier reproduces it. `letterSpacing` scales as well,
  and only the font size honours `maxFontSizeMultiplier`.
- **Android "Bold text"** (Android 12 and later): React Native 0.88 adds the
  accessibility weight adjustment to every typeface it draws, and the library
  applies it on the same versions.

## When the size changes

The resolved scale is part of the cache key, so a text size change needs no
`clearCache()`. It does need a re-render: heights computed before the change are
stale numbers held by your components. Recompute them when
`useWindowDimensions().fontScale` changes; the
[chat list guide](./chat-list#when-text-size-changes) shows where.

## Fixed scale for tests

`fontScale` in the config replaces the system scale with a fixed linear
multiplier, for tests and snapshots. Leave it out in an app: on Android 14 and
later no single multiplier matches how the system scales text.
