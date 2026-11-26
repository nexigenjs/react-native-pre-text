# Performance

A measurement runs in well under a millisecond: in the example's timing panel on
an iPhone simulator, about 0.1 ms per string cold and 0.015 ms from the cache.
Two things keep the cost down, and neither can change a result.

## One reused layout graph

On iOS `NSTextStorage`, `NSTextContainer` and `NSLayoutManager` are built once
and reused, because allocating them per call dominates a sub-millisecond
measurement; TextKit's line breaking is the cheap part.

## A measurement cache

Two generations of 512 entries. Reads check the newer generation, then the
older; a hit in the older one promotes it back. When the newer fills, it ages
wholesale and the previous older generation is dropped, so what survives is what
was *read*. The key covers every input the platform reads, the resolved text
scale and density included, so an entry is only ever returned for inputs that
would have produced it. In a list the style and width are constant while rows
repeat across re-renders and scrollback, which is where the hit rate lands.

This is a second-chance approximation of LRU, not the real thing. React Native
keeps a strict LRU in `TextMeasureCache`, which is exact at the same O(1). The
trade is a coarser policy for a much smaller one: two dictionaries and a
counter. It costs a ceiling of 1024 rather than 512, no recency ordering within a
generation, and slightly arbitrary lifetimes for entries written just before an
aging. Against a window of tens of rows, aging is rare enough that none of that
is reachable.

## Batch a list

`measureBatch` and `measureHeights` pay the JS/native crossing once for the
whole array and resolve the font once, so prefer them when sizing more than a
couple of rows.

## When to clear the cache

Call `clearCache()` when a font finishes loading. That changes what the same
inputs measure to, which a cache keyed on inputs cannot notice. Nothing else
needs invalidating: a system text size change lands on new entries rather than
stale ones.

## Timing it yourself

`example/` prints the timings: a whole pass over the corpus, median of ten,
measured cold with the cache cleared before each pass, again with it warm, and
once via `measureBatch`. It times a pass rather than a single call deliberately:
one measurement is the same order as `performance.now()`'s own resolution, so
timing one reports the clock.
