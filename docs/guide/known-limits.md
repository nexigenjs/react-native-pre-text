# Known limits

- **Nested `<Text>` with mixed styles**, such as a bold run or a styled mention
  inside a message, is not supported. The model is one style per measured
  string. Runs that differ only in colour or decoration measure the same.
- **`maxFontSizeMultiplier` before React Native 0.87.** Up to 0.86, React
  Native's own text measure cache (`areTextAttributesEquivalentLayoutWise` in
  `TextMeasureCache.h`) leaves `maxFontSizeMultiplier` out of its key. When the
  same string with the same style renders both with and without the prop, the
  second `<Text>` gets the size measured for the first, on both platforms.
  `measure()` returns what the prop asks for, so in that case it disagrees with
  the screen. Fixed in React Native 0.87 by facebook/react-native#56960.
- **`dynamicTypeRamp`** (iOS) is not supported.
- **An empty string** measures as `onLayout` reports it, which differs by
  platform. iOS lays out a placeholder in the style: one line of the style's
  height, `lineHeight` included, with width 0; `lastLineWidth` is 0 while React
  Native's `onTextLayout` describes the placeholder. Android lays out the empty
  text with the font alone: one line of the font's natural height, `lineHeight`
  ignored.
- **`textAlign: 'justify'` on Android** turns on inter-word justification, which
  lets Android's line breaker squeeze spaces and can fit a paragraph in fewer
  lines. The library measures ragged-right, so justified text can come out taller
  than it renders.
- **Android on an external display or under a density override** (React Native
  0.85 and 0.86): `onTextLayout` there converts line widths with the window's
  density, `onLayout` and this library with the screen's, so `lastLineWidth` can
  differ from `onTextLayout` by their ratio. React Native 0.87 converts both with
  the screen's.
- **iOS text scale at startup.** The scale is read from JS `Dimensions`. React
  Native can report 1.0 there for a moment at launch while the renderer already
  uses the real scale; measurements taken in that window come out unscaled until
  the next update.
- **Shrinking a container to the measured `width`** and rendering the text again
  at that width keeps the same lines on iOS, but not always on Android. There
  `highQuality` breaking optimises the whole paragraph against the width it is
  given, so a narrower box can choose different breaks: at a 2.0 text scale one
  Korean sample goes from 4 lines to 3. Leave Android text its full width, or
  check the narrow box on your content.
- **Web** is out of scope.
