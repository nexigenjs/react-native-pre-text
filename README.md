# @nexigen/react-native-pre-text

[![npm downloads](https://img.shields.io/npm/dm/@nexigen/react-native-pre-text)](https://www.npmjs.com/package/@nexigen/react-native-pre-text)

Know what a `<Text>` will render as, before it renders. Feeds and chat lists
that don't jump on a fast scroll, `scrollToIndex` that lands where it should,
and "Read more" without rendering twice.

[npm package](https://www.npmjs.com/package/@nexigen/react-native-pre-text) ·
[nexigenjs/react-native-pre-text](https://github.com/nexigenjs/react-native-pre-text)

https://github.com/user-attachments/assets/cb4ff55c-f463-43ac-ab83-e4fc29d4e7b3

`measure()` returns the height, line count and widest line for a string — the
same numbers `onLayout` reports afterwards. Hand those heights to `FlatList`'s
`getItemLayout` and the list stops guessing row heights, which is what makes a
feed or a chat jump on a fast scroll. [Why this exists](#why-this-exists) explains the
jump and shows the full `getItemLayout` setup; the example below is the
smallest use.

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

## Why this exists

It started with a chat screen. Fling through message history and the list
would jump: messages already on screen were suddenly somewhere else, as if the
list had teleported. Nothing in the chat code caused it. A React Native list
learns how tall a row is by rendering it first and measuring it afterwards, and
the jump is the moment it finds out.

Take `FlatList`, which is `VirtualizedList` underneath. A row's height is known
only once the row has mounted and its `onLayout` has fired. Until then
`getCellMetricsApprox` in `ListMetricsAggregator.js` gives it the average
height of the rows measured so far, and places every row after it on top of
that guess:

```js
offset =
  highestMeasuredCellFrame.offset +
  highestMeasuredCellFrame.length +
  this._averageCellLength * (index - highestMeasuredCellIndex - 1);
```

An average is fine for a feed of identical cards. A chat is the worst case for
it, with "ok" next to a pasted paragraph, so it is wrong for nearly every
individual message. Scrolled slowly, the list measures rows just ahead of the
viewport and every correction lands off screen. Flung, it outruns its render
window. The rows it skips are replaced by a spacer sized from the average, and
the rows it lands on are laid out after that spacer. Each row that then mounts
moves the average, and with it the spacer, so the rows on screen shift by the
accumulated error, again and again, until the skipped rows have been measured
too.

React Native knows. `VirtualizedList.js` caps the scrollable length at the
furthest row it has measured, so a fling cannot carry you into rows it has only
guessed at:

```js
// Without getItemLayout, we limit our tail spacer to the _highestMeasuredFrameIndex to
// prevent the user for hyperscrolling into un-measured area because otherwise content will
// likely jump around as it renders in above the viewport.
```

That comment also names the way out. Given `getItemLayout`, the list takes each
row's length and offset from you and never estimates or waits for `onLayout`.
It has always been there, and for text it has always been out of reach: a
message's height depends on where it wraps, and nothing could say where it
wraps until it was on screen. This library supplies that answer before
anything renders, from the same engine that will draw the text:

```tsx
import { measureHeights } from '@nexigen/react-native-pre-text';

const layout = useMemo(() => {
  let offset = 0;
  return measureHeights(messages.map((m) => m.text), STYLE, width).map(
    (height, index) => {
      const length = height + PAD * 2;
      const row = { length, offset, index };
      offset += length;
      return row;
    },
  );
}, [messages, width]);

<FlatList
  inverted
  data={messages}
  getItemLayout={(_, index) => layout[index]}
  renderItem={({ item, index }) => (
    <View style={{ height: layout[index].length, paddingVertical: PAD }}>
      <Text style={STYLE}>{item.text}</Text>
    </View>
  )}
/>;
```

## Use cases

The chat is where this started, not where it ends. Anything that has to know a
text's size before its first frame is the same problem.

- **Feeds, comments, reviews, threads.** Any virtualised list of text rows with
  different heights jumps on a fast scroll for the reason above, and takes the
  same `getItemLayout` fix.
- **`scrollToIndex` and `initialScrollIndex` that land.** "Jump to first
  unread", a deep link to a comment, a search hit inside a conversation.
  Without `getItemLayout`, `VirtualizedList.js` refuses to scroll to a row past
  the furthest one it has measured: it calls `onScrollToIndexFailed` with the
  average row height and leaves you to scroll somewhere near and retry. With
  it, the offset is known and the jump is one call:

  ```ts
  listRef.current?.scrollToIndex({ index: firstUnread, animated: false });
  ```

- **"Read more" without rendering twice.** The usual approach renders the full
  text, counts lines in `onTextLayout`, then renders again with
  `numberOfLines`, so the first frame shows the full text. Counting before
  render removes that frame:

  ```tsx
  const clamp = measure(text, STYLE, width).lineCount > 3;

  <Text style={STYLE} numberOfLines={clamp && !expanded ? 3 : undefined}>
    {text}
  </Text>;
  ```

- **Expanding text with an animation.** The target height is known before the
  animation starts, so there is no hidden measuring render to stage first.
- **Masonry and grids of text cards.** Putting a card in the shortest column
  needs its height before it is placed.
- **Labels sized before the first frame.** A tab indicator under labels of
  different lengths, a tooltip positioned around its text, a row of chips that
  wraps: `measureWidth()` gives the single-line width these layouts need,
  without a first frame at the wrong size.
- **Fitting text to a box.** Measurement is synchronous and cached, so finding
  the largest `fontSize` that fits a given height or line count is a short
  binary search rather than a series of renders.
- **Chat bubbles that hug their text.** `width` is the widest laid-out line,
  not the container, and `lastLineWidth` says whether a timestamp fits at the
  end of the last line or needs a line of its own. See
  [Known limits](#known-limits) before shrinking a container to that width.

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

`example/` runs that corpus by itself at launch, in every bundled font under
three scaling modes (the system text size, `allowFontScaling={false}`, and
`maxFontSizeMultiplier`), followed by the [use cases](#use-cases): the chat
list with `getItemLayout` and `scrollToIndex`, and a bubble shrunk to the
measured width. It needs no taps, so it can be relaunched at each system text
size, and it writes one `PRETEXT {json}` line per check to the device log.

Current results, RN 0.86, 65 cases × 5 fonts × 3 modes at each text size:

| Device | Width | Text sizes | Size vs `onLayout` | Worst gap |
|---|---|---|---|---|
| iPhone 17 Pro simulator, iOS 26.2 | 326 pt | 1.0, 1.235, 2.143 | all match | 1 px (0.333 pt) |
| Pixel 7 emulator, Android 16 | 335 dp | 1.0, 1.3, 2.0 | all match | 1 px (0.381 dp) |

The use cases pass at every size, with one expected exception: at Android's
2.0 scale, one Korean sample shrunk to its measured width breaks into fewer
lines (see [Known limits](#known-limits)). The same checks also pass in stock
Expo dev builds, Android on SDK 58 (RN 0.88, Nitro 0.37) and iOS on SDK 57
(RN 0.86), with the package installed from its npm tarball.

Line counts come from `onTextLayout`, and they agree everywhere but once: on
iOS at 1.235, `onTextLayout` reports 2 lines for one Fira Code sample whose
`onLayout` box is 3 lines tall, the same as `measure()` says. That disagreement
is inside RN.

Run `example/` on the device you support to validate the corpus, width and
fonts there.

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
registered through `UIAppFonts` on iOS and `assets/fonts` on Android. On
Android a `fontFamily` must be the asset's file name: asking for `'Fira Code'`
when the file is `FiraCode.ttf` falls back to the system font without a word,
on the screen and in `measure()` alike, so the two still agree and a check
passes without ever touching the font.

## Install

```sh
npm install @nexigen/react-native-pre-text react-native-nitro-modules
cd ios && pod install
```

New Architecture only. See [Nitro versions](#nitro-versions) for the version
pairing.

### Expo

Works in a development build; not in Expo Go, which cannot load native
modules.

```sh
npx expo install @nexigen/react-native-pre-text react-native-nitro-modules
npx expo prebuild
npx expo run:ios   # or: npx expo run:android
```

Verified with the example's checks in stock projects: SDK 58 on Android and
SDK 57 on iOS. SDK 58's own `expo-modules-jsi` does not compile on iOS with
Xcode 26.2, before this package is reached.

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
  maxLines?: number;              // mirrors numberOfLines
  allowFontScaling?: boolean;     // mirrors <Text>, default true
  maxFontSizeMultiplier?: number; // mirrors <Text>
  fontScale?: number;             // fixed override for tests; omit in apps
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

### System text size

`<Text>` follows the system text size unless told otherwise, and so does
`measure()`: both default to `allowFontScaling: true` and read the current
scale themselves. A `<Text>` that sets no scaling props needs none here. One
that does gets the same values:

```tsx
<Text style={STYLE} maxFontSizeMultiplier={1.5}>{text}</Text>;

measureHeight(text, STYLE, width, { maxFontSizeMultiplier: 1.5 });
```

Each platform scales the way its renderer does, and the library repeats that
rather than approximating it:

- **iOS** multiplies the font size and the line height by the content-size
  multiplier and leaves `letterSpacing` alone, as
  `RCTEffectiveFontSizeMultiplierFromTextAttributes` does.
- **Android** converts through RN's own `PixelUtil.toPixelFromSP`, then rounds
  the font up to a whole pixel, as `TextAttributeProps` does. From Android 14
  that conversion is nonlinear, so large text grows less than small text, and
  no single multiplier reproduces it. `letterSpacing` scales as well, and only
  the font size honours `maxFontSizeMultiplier`.

The resolved scale is part of the cache key, so a text size change needs no
`clearCache()`. It does need a re-render: heights computed before the change
are stale numbers held by your components. Recompute them when
`useWindowDimensions().fontScale` changes.

`fontScale` replaces the system scale with a fixed linear multiplier, for tests
and snapshots. Leave it out in an app.

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

Call `clearCache()` when a font finishes loading. That changes what the same
inputs measure to, which a cache keyed on inputs cannot notice. Nothing else
needs invalidating: the key includes the resolved text scale, so a system text
size change lands on new entries rather than stale ones.

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
| 0.1.x | 0.35.0 and up | Nitro 0.36.1 and 0.37.2, React Native 0.86 and 0.88 |

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
- **`maxFontSizeMultiplier` before RN 0.87.** Up to 0.86, RN's own text
  measure cache (`areTextAttributesEquivalentLayoutWise` in
  `TextMeasureCache.h`) leaves `maxFontSizeMultiplier` out of its key. When the
  same string with the same style renders both with and without the prop, the
  second `<Text>` gets the size measured for the first, on both platforms.
  `measure()` returns what the prop asks for, so in that case it disagrees with
  the screen. Fixed in RN 0.87 by facebook/react-native#56960.
- **`dynamicTypeRamp`** (iOS) is not supported.
- **Shrinking a container to the measured `width`** and rendering the text
  again at that width keeps the same lines in the example's checks on iOS, but
  not always on Android. There `highQuality` breaking optimises the whole
  paragraph against the width it is given, so a narrower box can choose
  different breaks: at a 2.0 text scale one Korean sample goes from 4 lines to
  3. Leave Android text its full width, or check the narrow box on your
  content.
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
