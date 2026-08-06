# @nexigen/react-native-pre-text

Know what a `<Text>` will render as, before it renders.

[npm package](https://www.npmjs.com/package/@nexigen/react-native-pre-text) ·
[nexigenjs/react-native-pre-text](https://github.com/nexigenjs/react-native-pre-text)

https://github.com/user-attachments/assets/cb4ff55c-f463-43ac-ab83-e4fc29d4e7b3

`measure()` returns the height, line count and widest line for a string — the
same numbers `onLayout` reports afterwards. That lets a list size its cells
before mounting them, so virtualisation never has to guess and never jumps.

```tsx
import { measureHeight } from '@nexigen/react-native-pre-text';

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

Verified against a 65-case corpus of real content — doubled spaces, tabs,
newlines, curly quotes, em dashes, non-breaking spaces from a paste, ™ and ©,
prices, ★ ratings, @handles, URLs, US addresses, CJK, Thai, Arabic, Hebrew,
Devanagari and Vietnamese. Emoji coverage includes separate isolation cases
for text and colour presentation selectors, keycaps, ZWJ families and
professions, skin-tone modifiers, regional flags and tag-sequence flags, plus
mixed and dense emoji runs.

The current iOS run on an iPhone 17 Pro at 326 pt matches `onLayout` in all
**65 / 65** cases with a 0.000 pt worst gap using the system font. The earlier
56-case corpus also matched **56 / 56** on a Galaxy M34 at 308 dp. Run
`example/` on either platform to validate the current corpus, width and font on
the device you support.

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

### Cross-platform font validation

The example keeps a horizontal font selector above the validation list. A
selection is applied to both the rendered `<Text>` and every pre-measurement,
then the entire corpus is recalculated. That makes fallback, wrapping and font
metric differences visible without editing the source between runs.

It includes the platform system font and four bundled families from different
groups: Inter (sans), Lora (serif), Fira Code (monospace) and Noto Sans
(multilingual sans). The four custom fonts are SIL Open Font License 1.1 assets
used only by the example; they are not included in the published library.
Their upstream links and individual license files live in
[`example/assets/fonts`](example/assets/fonts/README.md). The same files are
registered through `UIAppFonts` on iOS and `assets/fonts` on Android.

## Install

```sh
npm install @nexigen/react-native-pre-text react-native-nitro-modules
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

## Performance

Two things keep the per-call cost down, and neither can change a result:

- **One reused layout graph.** On iOS `NSTextStorage`, `NSTextContainer` and
  `NSLayoutManager` are built once and reused, because allocating them per call
  dominates a sub-millisecond measurement — TextKit's line breaking is the cheap
  part.
- **A measurement cache**, two generations of 512 entries. Reads check the newer
  generation, then the older; a hit in the older one promotes it back. When the
  newer fills it ages wholesale and the previous older generation is dropped, so
  what survives is what was *read*. The key covers every field the platform
  reads, so an entry is only ever returned for inputs that would have produced
  it. In a list the style and width are constant while rows repeat across
  re-renders and scrollback, which is where the hit rate lands.

  This is a second-chance approximation of LRU, not the real thing — React
  Native keeps a strict LRU in `TextMeasureCache`, which is exact at the same
  O(1). The trade is a coarser policy for a much smaller one: two dictionaries
  and a counter, no linked list to maintain. It costs a ceiling of 1024 rather
  than 512, no recency ordering within a generation, and slightly arbitrary
  lifetimes for entries written just before an aging. Against a window of tens
  of rows, aging is rare enough that none of that is reachable.

`measureBatch` pays the JS/native crossing once for the whole list and resolves
the font once, so prefer it when sizing more than a couple of rows.

Call `clearCache()` when a font finishes loading or the system font scale
changes. Those change what the same inputs measure to, which a cache keyed on
inputs cannot notice. Nothing else needs invalidating.

`example/` prints the timings — a whole pass over the corpus, median of ten,
measured cold with the cache cleared before each pass, again with it warm, and
once via `measureBatch`. It times a pass rather than a single call deliberately:
one measurement is the same order as `performance.now()`'s own resolution, so
timing one reports the clock, and dividing that by the case count manufactures
numbers like 0.0002 ms.

### What this deliberately does not do

A faster design exists: segment the text, measure each segment once, cache the
widths and add them up in JS to decide where lines break. That is how the
browser-oriented [`pretext`](https://github.com/chenglou/pretext) works, and it
has to — in a browser you cannot ask the layout engine where it would break
without forcing a reflow, so canvas widths plus JS arithmetic is the only way
out. Here there is no reflow to avoid, and summing cached segment widths would
give up the guarantee this library exists for:

- Android's `<Text>` defaults to `textBreakStrategy: highQuality`, which
  optimises breaks across the whole paragraph. Greedy arithmetic over segment
  widths does not approximate that, it disagrees with it.
- Kerning and ligatures across a segment boundary vanish when widths are summed
  rather than measured together.
- Script-specific minimum line heights, like the Thai case under
  [Known limits](#known-limits), are the platform's decision and are simply
  absent from the arithmetic.

Caching whole measurements gets the repeat-call cost without touching any of
that, because a memoised pure function returns what the function would have.

## Nitro versions

The package ships pre-generated Nitro glue in `nitrogen/`, and that glue is
written against Nitro's internal API, not a stable contract. The floor is
therefore a hard one; there is no ceiling.

| @nexigen/react-native-pre-text | react-native-nitro-modules | tested against |
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
