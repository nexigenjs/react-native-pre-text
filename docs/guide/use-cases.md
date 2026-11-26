# Use cases

The chat is where this started, not where it ends. Anything that has to know a
text's size before its first frame is the same problem.

## Feeds, comments, reviews, threads

Any virtualised list of text rows with different heights jumps on a fast scroll
for the same reason a chat does, and takes the same
[getItemLayout fix](./chat-list).

## "Read more" without rendering twice

The usual approach renders the full text, counts lines in `onTextLayout`, then
renders again with `numberOfLines`, so the first frame shows the full text.
Counting before render removes that frame:

```tsx
const clamp = measure(text, STYLE, width).lineCount > 3;

<Text style={STYLE} numberOfLines={clamp && !expanded ? 3 : undefined}>
  {text}
</Text>;
```

`measure(text, STYLE, width, { maxLines: 3 })` gives the collapsed height
directly, and `didTruncate` says whether three lines cut anything off.

## Chat bubbles and timestamps

`width` is the widest laid-out line, not the container, and `lastLineWidth` is
the last line's width. Together they say whether a timestamp fits at the end of
the last line or needs a line of its own:

```ts
const { width: textWidth, lastLineWidth } = measure(text, STYLE, maxBubbleText);
const timeFitsInline = lastLineWidth + GAP + TIME_WIDTH <= maxBubbleText;
```

Shrinking the bubble itself to `textWidth` keeps the same lines on iOS, but not
always on Android; see [Known limits](./known-limits).

## Expanding text with an animation

The target height is known before the animation starts, so there is no hidden
measuring render to stage first.

## Masonry and grids of text cards

Putting a card in the shortest column needs its height before it is placed.

## Labels sized before the first frame

A tab indicator under labels of different lengths, a tooltip positioned around
its text, a row of chips that wraps: `measureWidth()` gives the single-line
width these layouts need, without a first frame at the wrong size.

```ts
const indicatorWidth = measureWidth(tabs[active].label, TAB_STYLE);
```

## Fitting text to a box

Measurement is synchronous and cached, so finding the largest `fontSize` that
fits a given height or line count is a short binary search rather than a series
of renders.

```ts
function fit(text: string, width: number, maxLines: number) {
  let low = 10;
  let high = 40;
  while (high - low > 0.5) {
    const size = (low + high) / 2;
    const { lineCount } = measure(text, { fontSize: size }, width);
    if (lineCount <= maxLines) low = size;
    else high = size;
  }
  return low;
}
```
