# react-native-pre-text

Know what a `<Text>` will render as, before it renders.

`measure()` returns the height, line count and widest line for a string — the
same numbers `onLayout` reports afterwards. That lets a list size its cells
before mounting them, so virtualisation never has to guess and never jumps.

```tsx
import { measureHeight } from 'react-native-pre-text';

const STYLE = { fontFamily: 'System', fontSize: 16, lineHeight: 24 };

<FlatList
  data={messages}
  renderItem={({ item }) => (
    <View style={{ height: measureHeight(item.text, STYLE, width) + PAD * 2 }}>
      <Text style={STYLE}>{item.text}</Text>
    </View>
  )}
/>;
```

## Why it is accurate

Both platforms measure with the engine that will draw the text — iOS TextKit,
Android `StaticLayout`. This is not a model of the renderer, it is the renderer
answering early. Unicode line breaking, kinsoku, bidi and Thai dictionary
breaking all come for free, because they are the same code paths `<Text>` uses.

Verified against a 56-case corpus of real content — doubled spaces, tabs,
newlines, curly quotes, em dashes, non-breaking spaces from a paste, ™ and ©,
prices, ★ ratings, @handles, URLs, US addresses, emoji (ZWJ families, skin
tones, flags), CJK, Thai, Arabic, Hebrew, Devanagari, Vietnamese:

| platform | device | width | cases matching `onLayout` |
|---|---|---|---|
| iOS | iPhone 17 Pro | 326 pt | **56 / 56**, worst gap 0.265 pt |
| Android | Galaxy M34, density 2.8125 | 308 dp | **56 / 56** |

Run `example/` to reproduce: it renders every case and scores `measure()`
against `onLayout` live.

## Install

```sh
npm install react-native-pre-text react-native-nitro-modules
cd ios && pod install
```

New Architecture only. See [Nitro versions](#nitro-versions) for the version
pairing.

## API

Every function takes the style you already pass to `<Text>`. There is no
separate measurement font to keep in sync — a drifted font does not fail
loudly, it just returns heights that are quietly wrong.

```ts
measure(text, style, width, config?): TextMeasurement
measureHeight(text, style, width, config?): number
measureBatch(texts, style, width, config?): TextMeasurement[]
measureHeights(texts, style, width, config?): number[]
measureWidth(text, style, config?): number
getFontMetrics(style, config?): FontMetrics
clearCache(): void
```

```ts
type TextMeasurement = {
  width: number;         // widest laid-out line, not the container
  height: number;        // what onLayout will report
  lineCount: number;
  lastLineWidth: number; // e.g. to place a timestamp in a bubble
  didTruncate: boolean;  // maxLines cut the text short
};

type MeasureConfig = {
  maxLines?: number;   // mirrors numberOfLines
  fontScale?: number;  // Dynamic Type multiplier, default 1
};
```

`measureBatch` pays the JS/native crossing once for a whole list.

### What the style has to include

Anything that can move a line break or change a line's height:
`fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `lineHeight`,
`letterSpacing`, `textTransform`, `fontVariant`, `writingDirection`, and on
Android `includeFontPadding`, `textBreakStrategy`,
`android_hyphenationFrequency`.

Colour, alignment and decoration cannot change the measurement and are ignored.

### Dynamic Type

`<Text>` has `allowFontScaling` on by default, so a user changing text size in
system settings changes every height. Pass the live scale, and clear the cache
when it changes:

```ts
import { PixelRatio } from 'react-native';

measureHeight(text, style, width, { fontScale: PixelRatio.getFontScale() });
```

If your `<Text>` sets `allowFontScaling={false}`, leave `fontScale` alone.

## Nitro versions

The package ships pre-generated Nitro glue in `nitrogen/`, and that glue is
built against a specific `react-native-nitro-modules` version — it is internal
API, not a stable contract. Nitro is pre-1.0, so treat each minor as its own
line and keep the two in step.

| react-native-pre-text | react-native-nitro-modules | React Native |
|---|---|---|
| 0.1.x | 0.36.x | 0.86 |

Older Nitro is not a matter of adapting the API — 0.32 shipped in December
2025, months before React Native 0.85 and 0.86 existed, so it was never built
against them. Supporting an older line means regenerating with that line's
`nitrogen` and testing against the React Native version it targeted.

## Known limits

- **Thai and other scripts with a script-specific minimum line height.** iOS
  will not compress a Thai line below roughly 24.5 pt even when `lineHeight` is
  24. Measured correctly here because the platform reports it, but worth
  knowing if you also compute layout yourself.
- **Nested `<Text>` with mixed styles** — a bold run or a link inside a message
  — is not supported. The model is one style per measured string.
- **`numberOfLines` / `didTruncate`** is implemented but not yet covered by the
  corpus.
- Web is out of scope.

## Development

```sh
npm install          # library deps
npm run codegen      # regenerate nitrogen/ after editing src/PreText.nitro.ts

cd example
npm install
npm run ios          # or: npm run android
```

## License

MIT. See [LICENSE](LICENSE).
