# Chat list with getItemLayout

A virtualised list jumps on a fast scroll because it guesses the height of rows
it has not rendered yet ([why](./why)). `getItemLayout` replaces the guess with
real numbers. This page builds that for a chat.

## The recipe

```tsx
import { useMemo } from 'react';
import { FlatList, Text, useWindowDimensions, View } from 'react-native';
import { measureHeights } from '@nexigen/react-native-pre-text';

const STYLE = { fontSize: 16, lineHeight: 22 };
const PAD = 8;

function Chat({ messages, width }) {
  // measureHeights reads the system text size itself. Listing it in the deps
  // recomputes the layout when the user changes it.
  const { fontScale } = useWindowDimensions();

  const layout = useMemo(() => {
    let offset = 0;
    return measureHeights(messages.map(m => m.text), STYLE, width).map(
      (height, index) => {
        const length = height + PAD * 2;
        const row = { length, offset, index };
        offset += length;
        return row;
      },
    );
  }, [messages, width, fontScale]);

  return (
    <FlatList
      inverted
      data={messages}
      keyExtractor={m => m.id}
      getItemLayout={(_, index) => layout[index]}
      renderItem={({ item, index }) => (
        <View style={{ height: layout[index].length, paddingVertical: PAD }}>
          <Text style={STYLE}>{item.text}</Text>
        </View>
      )}
    />
  );
}
```

`width` is the width the `<Text>` gets inside the row, after the row's own
horizontal padding and the bubble's chrome, not the screen width.

## Why the row height is pinned

Once `getItemLayout` is set, `VirtualizedList` stops listening to the cells'
`onLayout` altogether. It trusts your numbers and never corrects them. Setting
the row's `height` to the same `length` makes the row exactly what the list was
told, by construction. If a measurement were ever off, the cost is a pixel of
text, not a list that drifts.

## Everything in the row counts

`getItemLayout` describes the whole row, so every part of its height has to be
known before render:

- **Padding, margins, borders**: constants, add them.
- **Avatars, names, timestamps**: fixed heights, or measure their text too.
- **Images**: their dimensions have to come with the message data.
- **`ItemSeparatorComponent`**: its height belongs in the offsets.
- **Anything sized after it loads** (a link preview fetched later) breaks the
  premise. Give it a fixed box, or keep it out of the list's rows.

Nested `<Text>` with mixed styles, such as a bold run or a styled mention inside
a message, is not supported: the model is one style per measured string. Runs
that differ only in colour or decoration measure the same and are fine.

## Jump to a message

`scrollToIndex` without `getItemLayout` refuses to scroll past the furthest row
it has measured: it calls `onScrollToIndexFailed` with the average row height
and leaves you to scroll near and retry. With it, the offset is known and the
jump is one call:

```ts
listRef.current?.scrollToIndex({ index: firstUnread, animated: false });
```

`initialScrollIndex` works the same way, so a conversation can open at the
first unread message without a visible scroll.

## When text size changes

The library reads the system text size on every call, and the size is part of
its cache key, so there is nothing to clear. What goes stale is the `layout`
your component holds. Keep `fontScale` from `useWindowDimensions()` in the
memo's dependencies, as above, so the layout is rebuilt when the user changes
their text size. (The `react-hooks/exhaustive-deps` rule calls it unnecessary,
because the closure never reads it; the dependency is the point.)

If your text component turns `allowFontScaling` off, measure with
`{ allowFontScaling: false }` too. See [System text size](./text-size).

## Lots of messages

`measureHeights` measures the whole array in one crossing to native, and
measurements are cached, so rebuilding the layout after a new message mostly
hits the cache. The offset sum is linear in the number of rows; for very long
histories, keep a page of messages in the list rather than all of them.
