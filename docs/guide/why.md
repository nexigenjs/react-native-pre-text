# Why chat lists jump

It started with a chat screen. Fling through message history and the list
would jump: messages already on screen were suddenly somewhere else, as if the
list had teleported. Nothing in the chat code caused it. A React Native list
learns how tall a row is by rendering it first and measuring it afterwards, and
the jump is the moment it finds out.

## The list guesses

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
individual message.

## Why only a fast scroll

Scrolled slowly, the list measures rows just ahead of the viewport and every
correction lands off screen. Flung, it outruns its render window. The rows it
skips are replaced by a spacer sized from the average, and the rows it lands on
are laid out after that spacer. Each row that then mounts moves the average, and
with it the spacer, so the rows on screen shift by the accumulated error, again
and again, until the skipped rows have been measured too.

React Native knows. `VirtualizedList.js` caps the scrollable length at the
furthest row it has measured, so a fling cannot carry you into rows it has only
guessed at:

```js
// Without getItemLayout, we limit our tail spacer to the _highestMeasuredFrameIndex to
// prevent the user for hyperscrolling into un-measured area because otherwise content will
// likely jump around as it renders in above the viewport.
```

## The way out

That comment also names it. Given `getItemLayout`, the list takes each row's
length and offset from you and never estimates or waits for `onLayout`. It has
always been there, and for text it has always been out of reach: a message's
height depends on where it wraps, and nothing could say where it wraps until it
was on screen.

This library supplies that answer before anything renders, from the same engine
that will draw the text. [The chat list guide](./chat-list) has the full
recipe.

## Why not add up character widths in JS?

A faster design exists: segment the text, measure each segment once, cache the
widths and add them up in JS to decide where lines break. That is how the
browser-oriented [`pretext`](https://github.com/chenglou/pretext) works, and it
has to: in a browser you cannot ask the layout engine where it would break
without forcing a reflow. In React Native there is no reflow to avoid, and
summing widths would give up exactness:

- Android's `<Text>` defaults to `textBreakStrategy: highQuality`, which
  optimises breaks across the whole paragraph. Greedy arithmetic over segment
  widths does not approximate that, it disagrees with it.
- Kerning and ligatures across a segment boundary vanish when widths are summed
  rather than measured together.
- Script-specific line heights, such as the taller lines Thai and other scripts
  get from their fallback fonts, are the platform's decision and are simply
  absent from the arithmetic.

So this library asks the platform directly, and caches whole measurements:
a memoised pure function returns what the function would have.
