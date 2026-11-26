# Getting started

## Install

```sh
npm install @nexigen/react-native-pre-text react-native-nitro-modules
cd ios && pod install
```

React Native 0.85 or later, New Architecture only. The package ships
pre-generated [Nitro](https://nitro.margelo.com) glue and needs
`react-native-nitro-modules` 0.35.0 or later.

### Expo

Works in a development build; not in Expo Go, which cannot load native
modules.

```sh
npx expo install @nexigen/react-native-pre-text react-native-nitro-modules
npx expo prebuild
npx expo run:ios   # or: npx expo run:android
```

Fonts loaded through expo-font, aliases included (`Inter_600SemiBold`), are
looked up the way `<Text>` looks them up.

## Measure

Every function takes the style you already pass to `<Text>`. There is no
separate measurement font to keep in sync: a drifted font does not fail loudly,
it just returns heights that are quietly wrong.

```tsx
import { measure } from '@nexigen/react-native-pre-text';

const STYLE = { fontSize: 16, lineHeight: 24 };

const { height, lineCount, width, lastLineWidth } = measure(
  'Are we still on for 7?',
  STYLE,
  containerWidth,
);
```

`height` is the number `onLayout` will report for
`<Text style={STYLE}>` laid out in `containerWidth`. `width` is the widest
line, not the container. The call is synchronous: no `await`, and nothing is
rendered.

To size a list, measure every row at once. `measureHeights` crosses into native
once for the whole array:

```ts
import { measureHeights } from '@nexigen/react-native-pre-text';

const heights = measureHeights(
  messages.map(m => m.text),
  STYLE,
  containerWidth,
);
```

## Pass the same props as the `<Text>`

The `<Text>` props that change the layout go in the last argument, with the
same names and the same defaults:

```tsx
<Text style={STYLE} numberOfLines={3} maxFontSizeMultiplier={1.5}>
  {text}
</Text>;

measure(text, STYLE, width, { maxLines: 3, maxFontSizeMultiplier: 1.5 });
```

A `<Text>` that sets none of them needs no config. One that does needs the same
values here, or the measurement describes a different `<Text>`.

::: tip A shared text component
If your app renders text through one wrapper around `<Text>` that turns
`allowFontScaling` off, pass `{ allowFontScaling: false }` to every
measurement as well, for example from a small wrapper of your own. Skipping it
is a quiet failure: heights are right at the default text size and wrong at
every other, so a chat starts jumping only for the users who changed their text
size. See [System text size](./text-size).
:::

## Next

- [Chat list with getItemLayout](./chat-list): the recipe that stops the jump.
- [Use cases](./use-cases): "Read more", bubbles, labels, masonry.
- [API](../api): every function and type.
