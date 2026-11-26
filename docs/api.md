# API

Every function takes the style you already pass to `<Text>`, and the width the
`<Text>` is laid out in. All of them are synchronous.

```ts
import {
  measure,
  measureHeight,
  measureBatch,
  measureHeights,
  measureWidth,
  getFontMetrics,
  clearCache,
} from '@nexigen/react-native-pre-text';
```

## measure

```ts
measure(text: string, style: MeasurableStyle, width: number, config?: MeasureConfig): TextMeasurement
```

Lays `text` out in `width` and returns what the equivalent `<Text>` reports.

```ts
type TextMeasurement = {
  width: number;         // widest laid-out line, not the container
  height: number;        // what onLayout will report
  lineCount: number;
  lastLineWidth: number; // e.g. to place a timestamp in a bubble
  didTruncate: boolean;  // maxLines cut the text short
};
```

A `width` that is not a finite number (a container not laid out yet) means no
constraint; a negative one means no room.

## measureHeight

```ts
measureHeight(text, style, width, config?): number
```

`measure(...).height`.

## measureBatch / measureHeights

```ts
measureBatch(texts: string[], style, width, config?): TextMeasurement[]
measureHeights(texts: string[], style, width, config?): number[]
```

The same, for a whole list in one crossing to native, with the font resolved
once. Prefer them for more than a couple of rows.

## measureWidth

```ts
measureWidth(text, style, config?): number
```

The natural width of the text on one unwrapped line: what a `<Text>` with no
width constraint reports.

## getFontMetrics

```ts
getFontMetrics(style, config?): FontMetrics

type FontMetrics = {
  ascender: number;   // distance above the baseline
  descender: number;  // distance below the baseline, positive on both platforms
  xHeight: number;
  capHeight: number;
  lineGap: number;
  lineHeight: number; // laid-out height of one line in this style
};
```

iOS reads `capHeight` and `xHeight` from the font's tables; Android has no such
API and measures the ink of "T" and "x", as React Native's `onTextLayout` does.

## clearCache

```ts
clearCache(): void
```

Call it after a font finishes loading. Nothing else needs it; see
[Performance](./guide/performance#when-to-clear-the-cache).

## MeasurableStyle

The style properties that can move a line break or change a line's height:

```ts
type MeasurableStyle = Pick<
  TextStyle,
  | 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle'
  | 'lineHeight' | 'letterSpacing' | 'textTransform' | 'fontVariant'
  | 'writingDirection' | 'includeFontPadding'
>;
```

Colour and decoration cannot change the measurement and are ignored, so the
style object you pass to `<Text>` can be passed as it is. So is alignment, except
`textAlign: 'justify'` on Android; see [Known limits](./guide/known-limits).

## MeasureConfig

The `<Text>` props, as opposed to its style, that change the layout. Each mirrors
the prop of the same name and shares its default, so a `<Text>` that sets none of
them needs none here.

```ts
type MeasureConfig = {
  maxLines?: number;              // numberOfLines; 0, negative or non-finite = no limit
  allowFontScaling?: boolean;     // default true
  maxFontSizeMultiplier?: number; // 1 or more caps the system scale
  textBreakStrategy?: 'simple' | 'highQuality' | 'balanced'; // Android, default highQuality
  android_hyphenationFrequency?: 'none' | 'normal' | 'full';
  fontScale?: number;             // fixed linear override for tests; omit in apps
};
```

## Supported versions

| Package | React Native | react-native-nitro-modules | Tested against |
|---|---|---|---|
| 1.x | 0.85 and up | 0.35.0 and up | Nitro 0.36.1 and 0.37.2, React Native 0.86 and 0.88 |
| 0.1.x | New Architecture | 0.35.0 and up | Nitro 0.36.1, React Native 0.86 |

The package ships pre-generated Nitro glue written against Nitro's internal
API, so the Nitro floor is a hard one: 0.35.0 restructured the Android JNI layer
the glue inherits from. The range is open at the top; pin
`react-native-nitro-modules` yourself if you would rather fail at install time
than at build time.
