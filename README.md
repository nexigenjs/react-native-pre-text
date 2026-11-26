# @nexigen/react-native-pre-text

[![npm downloads](https://img.shields.io/npm/dm/@nexigen/react-native-pre-text)](https://www.npmjs.com/package/@nexigen/react-native-pre-text)

Know what a `<Text>` will render as, before it renders. Feeds and chat lists
that don't jump on a fast scroll, `scrollToIndex` that lands where it should,
and "Read more" without rendering twice.

**[Documentation](https://nexigenjs.github.io/react-native-pre-text/)** ·
[npm](https://www.npmjs.com/package/@nexigen/react-native-pre-text) ·
[GitHub](https://github.com/nexigenjs/react-native-pre-text)

https://github.com/user-attachments/assets/cb4ff55c-f463-43ac-ab83-e4fc29d4e7b3

`measure()` returns the height, line count and widest line of a string, the
same numbers `onLayout` reports afterwards. It asks the engine that will draw the
text, iOS TextKit and Android `StaticLayout`, so line breaking, emoji, CJK, Thai
and bidi come out exactly as rendered, and it repeats what React Native does
between that engine and `onLayout`: pixel rounding, font resolution, line
height, the system text size.

## Why chat lists jump

A React Native list learns how tall a row is by rendering it first. Until a row
has mounted, `FlatList` places it using the average height of the rows measured
so far. In a chat, with "ok" next to a pasted paragraph, the average is wrong
for nearly every message, and on a fast fling every row that mounts moves the
rows on screen by the accumulated error. `getItemLayout` replaces the guess with
real heights; this library is where the heights come from.
[The full story](https://nexigenjs.github.io/react-native-pre-text/guide/why).

## Install

```sh
npm install @nexigen/react-native-pre-text react-native-nitro-modules
cd ios && pod install
```

React Native 0.85 or later, New Architecture only, `react-native-nitro-modules`
0.35.0 or later. In Expo, use a development build (`npx expo prebuild`); Expo Go
cannot load native modules.

## A chat list that doesn't jump

```tsx
import { measureHeights } from '@nexigen/react-native-pre-text';

const STYLE = { fontSize: 16, lineHeight: 22 };

// measureHeights reads the system text size itself; listing it in the deps
// rebuilds the layout when the user changes it.
const { fontScale } = useWindowDimensions();

const layout = useMemo(() => {
  let offset = 0;
  return measureHeights(messages.map(m => m.text), STYLE, textWidth).map(
    (height, index) => {
      const length = height + PAD * 2;
      const row = { length, offset, index };
      offset += length;
      return row;
    },
  );
}, [messages, textWidth, fontScale]);

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

With real offsets, `scrollToIndex` and `initialScrollIndex` land on the row the
first time. [The chat list guide](https://nexigenjs.github.io/react-native-pre-text/guide/chat-list)
covers what else the row height has to include.

## Use cases

- **Feeds, comments, reviews, threads**: any list of text rows with different
  heights.
- **"Read more"** without rendering twice: `measure(text, style, width).lineCount > 3`.
- **Chat bubbles and timestamps**: `width` is the widest line, `lastLineWidth`
  says whether a timestamp fits on the last line.
- **Labels sized before the first frame**: tab indicators, tooltips, chips,
  with `measureWidth()`.
- **Masonry grids, expanding text, fitting text to a box.**

[More, with code](https://nexigenjs.github.io/react-native-pre-text/guide/use-cases).

## API

Every function takes the style you already pass to `<Text>` and is synchronous.

```ts
measure(text, style, width, config?): TextMeasurement
measureHeight(text, style, width, config?): number
measureBatch(texts, style, width, config?): TextMeasurement[]
measureHeights(texts, style, width, config?): number[]
measureWidth(text, style, config?): number
getFontMetrics(style, config?): FontMetrics
clearCache(): void

type TextMeasurement = {
  width: number;         // widest laid-out line, not the container
  height: number;        // what onLayout will report
  lineCount: number;
  lastLineWidth: number;
  didTruncate: boolean;  // maxLines cut the text short
};

// The <Text> props that change the layout, each with <Text>'s default.
type MeasureConfig = {
  maxLines?: number;              // numberOfLines
  allowFontScaling?: boolean;     // default true
  maxFontSizeMultiplier?: number;
  textBreakStrategy?: 'simple' | 'highQuality' | 'balanced'; // Android
  android_hyphenationFrequency?: 'none' | 'normal' | 'full';
  fontScale?: number;             // fixed override for tests; omit in apps
};
```

Pass the same props as the `<Text>`. In particular, if your text component turns
`allowFontScaling` off, measure with `{ allowFontScaling: false }` too: otherwise
heights are right at the default text size and wrong at every other.
[System text size](https://nexigenjs.github.io/react-native-pre-text/guide/text-size) ·
[Full API](https://nexigenjs.github.io/react-native-pre-text/api).

## Checked against `onLayout`

The `example/` app checks every measurement against the rendered `<Text>`, by
itself, at launch: a 65-case corpus of real content in five fonts and three
scaling modes, more styles and weights, `maxLines`, edge cases and the chat list.
On React Native 0.86:

| Device | Text sizes | Checks |
|---|---|---|
| iPhone 17 Pro simulator, iOS 26.2 | 1.0, 1.235, 2.143 | 69 of 69 at every size |
| Pixel 7 emulator, Android 16 | 1.0, 1.3, 2.0 | 58 of 58; 57 at 2.0 (a known limit) |

CI runs the same checks on an Android emulator for every pull request.
[How it stays accurate](https://nexigenjs.github.io/react-native-pre-text/guide/accuracy).

## Upgrading to 1.0

0.1 measured at a text scale of 1 unless told otherwise; 1.0 follows the system
text size the way `<Text>` does. Remove `{ fontScale: PixelRatio.getFontScale() }`,
pass `{ allowFontScaling: false }` for text that doesn't scale, and move
`textBreakStrategy` and `android_hyphenationFrequency` from the style to the
config. [All changes](https://nexigenjs.github.io/react-native-pre-text/guide/upgrading).

## Known limits

Nested `<Text>` with mixed styles (a bold run inside a message) is not
supported; the model is one style per string. Web is out of scope.
[The full list](https://nexigenjs.github.io/react-native-pre-text/guide/known-limits).

## Development

```sh
npm install          # library deps
npm run codegen      # regenerate nitrogen/ after editing src/PreText.nitro.ts

cd example
npm install
npm run ios          # or: npm run android
```

With the example installed on an Android device or emulator,
`npm run check:android-device` runs its self-checks at text sizes 1.0, 1.3 and
2.0 and fails on anything outside the known limits. The docs live in `docs/`
(`npm run dev` there).

## License

MIT. See [LICENSE](LICENSE).
