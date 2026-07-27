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

Measuring with the same engine is necessary but not sufficient: React Native
then rounds the result **up** to the next whole device pixel before Yoga sees
it, `ceil(size * pointScaleFactor) / pointScaleFactor` in
`RCTTextLayoutManager.mm`, repeated in `ParagraphShadowNode.cpp` under the
comment "Rounding to *next* value on the pixel grid". Handing back TextKit's
raw fractional value therefore lands short of `onLayout` by up to one pixel —
0.333 pt at 3x, 0.5 pt at 2x, always short and never over, because the platform
ceils rather than rounds. Both platforms apply that same step, which is why
`pixelRatio` is required on iOS too and not only on Android.

Verified against a 56-case corpus of real content — doubled spaces, tabs,
newlines, curly quotes, em dashes, non-breaking spaces from a paste, ™ and ©,
prices, ★ ratings, @handles, URLs, US addresses, emoji (ZWJ families, skin
tones, flags), CJK, Thai, Arabic, Hebrew, Devanagari, Vietnamese:

| platform | device | width | cases matching `onLayout` |
|---|---|---|---|
| iOS | iPhone 17 Pro | 326 pt | **56 / 56** |
| Android | Galaxy M34, density 2.8125 | 308 dp | **56 / 56** |

Those runs predate the pixel-grid rounding above, when iOS's worst gap was
0.265 pt — inside the 0.5 pt tolerance, so every case still counted as a match.
Re-run `example/` for the current figure.

Each case is checked three ways: height against `onLayout`, width against
`onLayout` where the text fits on one line, and width against an unwrapped
render for every case. That third check exists because a wrapped `<Text>`
cannot report its own longest line — `RCTTextLayoutManager.mm` overwrites the
width with the container's outright:

```objc
if (textDidWrap) { size.width = textContainer.size.width; }
```

No style changes that, so the example renders each sample a second time inside a
horizontal `ScrollView`, which grants an unbounded width. Nothing wraps there,
and `onLayout` gives up the real longest line to compare `measureWidth()`
against.

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
written against Nitro's internal API, not a stable contract. The floor is
therefore a hard one; there is no ceiling.

| react-native-pre-text | react-native-nitro-modules | tested against |
|---|---|---|
| 0.1.x | 0.35.0 and up | Nitro 0.36.1, React Native 0.86 |

0.35.0 is an architectural boundary, not a policy choice. That release
restructured the Android JNI layer: `JHybridObject` split into nested
`JavaPart` / `CxxPart` classes in C++, and Kotlin's `HybridObject` gained a
matching `CxxPart`. The shipped glue is built on that split —
`JHybridPreTextSpec` inherits from both parts — so it cannot compile against
0.34 or earlier whatever React Native version is in play. Compiling the
generated JNI translation unit against 0.34.1 fails with seven errors, the
first being `no member named 'CxxPart' in 'margelo::nitro::JHybridObject'`;
against 0.35.0, 0.35.10, 0.36.1 and 0.36.3 it compiles clean.

From 0.35.0 up, nothing in the API this glue calls has moved. The only runtime
changes are inside Nitro's own implementation — `Promise`, `ReferenceState`,
`ThreadPool`, `WeakReference` — plus the `NITRO_VERSION` literal. On iOS the
base `HybridObject.swift` is byte-identical, and the pod dependency name and
CMake target are stable throughout.

The range is left open at the top. Nitro is pre-1.0 and 0.34 → 0.35 shows a
minor can restructure the layer this glue inherits from, so if a future minor
does break it the fix is a regenerated release of this package rather than a
range that refused to install. Pin `react-native-nitro-modules` yourself if
you would rather fail at install time than at build time.

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
