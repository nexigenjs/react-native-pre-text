package com.margelo.nitro.pretext

import android.content.res.AssetManager
import android.content.res.Configuration
import android.graphics.Typeface
import android.os.Build
import android.text.BoringLayout
import android.text.Layout
import android.text.SpannableString
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.graphics.Paint
import android.graphics.Rect
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.modules.systeminfo.ReactNativeVersion
import com.facebook.react.uimanager.PixelUtil
import com.margelo.nitro.NitroModules
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * `StaticLayout` — the same class `TextView` uses. The knobs mirror
 * `ReactTextView`: `includeFontPadding` adds to the height and `breakStrategy`
 * moves the break points, so measuring without them is precise about the wrong
 * layout. `lineHeight` goes through a span because that is how RN applies it.
 */
@DoNotStrip
class PreText : HybridPreTextSpec() {

  private val typefaceCache = HashMap<String, Typeface>()

  /**
   * Measurement cache, two generations giving each entry one second chance.
   *
   * Reads check the newer generation, then the older; a hit in the older one
   * promotes it back. When the newer fills, it ages wholesale into the older
   * slot and the previous older generation is dropped — so what survives is
   * what was *read*, not what was recently written.
   *
   * A deliberate approximation of LRU rather than the real thing. React
   * Native's own `TextMeasureCache` keeps a strict LRU, which is exact and
   * equally O(1); the trade taken here is a coarser policy for a much smaller
   * one. The costs are real and accepted: the ceiling is 2x the cap, there is
   * no recency ordering within a generation, and an entry written just before
   * an aging gets less grace than one written just after. Against a 512 cap and
   * a list window of tens of rows, aging is rare enough that none of it is
   * reachable in practice.
   *
   * The key covers everything `StaticLayout` reads, so an entry is only ever
   * returned for inputs that would have produced it. This buys time, not
   * accuracy.
   */
  private var hotCache = HashMap<String, TextMeasurement>()
  private var coldCache = HashMap<String, TextMeasurement>()

  /** Nitro makes no promise about the calling thread, and this state is shared. */
  private val lock = Any()

  private companion object {
    /**
     * Physical pixels. JS's `UNBOUNDED_WIDTH` is 1e6 dp, which is several
     * million px at a high density; capping that at 1e6 px would wrap a long
     * "unbounded" line. 2^30 keeps every Int conversion and StaticLayout's own
     * arithmetic safe while staying far past any real text.
     */
    const val MAX_LAYOUT_WIDTH = 1_073_741_824.0

    /** Per generation. Two are live at once, so the ceiling is 1024 entries. */
    const val CACHE_CAP = 512

    /**
     * RN's own probe glyphs and amplification factor, from `FontMetricsUtil`.
     * "T" rather than "H" only because that is the glyph RN picks, and matching
     * it is worth more here than the marginally taller letter.
     */
    const val CAP_HEIGHT_GLYPH = "T"
    const val X_HEIGHT_GLYPH = "x"
    const val GLYPH_AMPLIFICATION = 100f

    /** `stylistic-one` … `stylistic-twenty` → OpenType `ss01` … `ss20`. */
    val STYLISTIC_SETS: Map<String, Int> = listOf(
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
      "eighteen", "nineteen", "twenty"
    ).mapIndexed { index, name -> "stylistic-$name" to index + 1 }.toMap()
  }

  // MARK: - Public API

  override fun measure(
    text: String,
    spec: TextSpec,
    options: MeasureOptions
  ): TextMeasurement = synchronized(lock) {
    val density = densityOf(options)
    val sizes = sizesOf(spec, density)
    val specKey = layoutKey(spec, sizes, options)
    cached(text, spec, specKey, options, density, sizes) { buildPaint(spec, sizes) }
  }

  override fun measureBatch(
    texts: Array<String>,
    spec: TextSpec,
    options: MeasureOptions
  ): Array<TextMeasurement> = synchronized(lock) {
    val density = densityOf(options)
    val sizes = sizesOf(spec, density)
    val specKey = layoutKey(spec, sizes, options)
    // Built at most once for the batch, and not at all on a full cache hit.
    var paint: TextPaint? = null
    Array(texts.size) { i ->
      cached(texts[i], spec, specKey, options, density, sizes) {
        val existing = paint
        existing ?: buildPaint(spec, sizes).also { paint = it }
      }
    }
  }

  override fun getFontMetrics(spec: TextSpec): FontMetrics = synchronized(lock) {
    // Built at the screen's real density, because that is where RN rounds the
    // font to a whole pixel, then read back in dp.
    val density = PixelUtil.getDisplayMetricDensity().toDouble()
    val sizes = sizesOf(spec, density)
    val paint = buildPaint(spec, sizes)
    val metrics = paint.fontMetrics
    FontMetrics(
      ascender = -metrics.ascent / density,
      descender = metrics.descent / density,
      xHeight = glyphHeight(paint, X_HEIGHT_GLYPH) / density,
      capHeight = glyphHeight(paint, CAP_HEIGHT_GLYPH) / density,
      lineGap = metrics.leading / density,
      // The span renders ceil(px). JS replaces this value with a laid-out line.
      lineHeight = (
        sizes.lineHeightPx?.let { ceil(it.toDouble()) }
          ?: (metrics.descent - metrics.ascent).toDouble()
        ) / density
    )
  }

  override fun clearCache() = synchronized(lock) {
    typefaceCache.clear()
    hotCache.clear()
    coldCache.clear()
  }

  // MARK: - Cache

  /** Caller must hold [lock]. */
  private fun cached(
    text: String,
    spec: TextSpec,
    specKey: String,
    options: MeasureOptions,
    density: Double,
    sizes: Sizes,
    paint: () -> TextPaint
  ): TextMeasurement {
    // NUL separates the two halves so no text can forge a spec key.
    val key = "$specKey\u0000$text"

    hotCache[key]?.let { return it }
    coldCache[key]?.let {
      // Promote, so something still in use survives the next aging.
      hotCache[key] = it
      return it
    }

    val result = measureWith(paint(), text, spec, options, density, sizes)

    hotCache[key] = result
    if (hotCache.size >= CACHE_CAP) {
      coldCache = hotCache
      hotCache = HashMap()
    }
    return result
  }

  /**
   * Everything that can move a break or change a line's height on Android —
   * including `includeFontPadding`, `textBreakStrategy` and
   * `hyphenationFrequency`, which are ignored on iOS but decide the layout
   * here.
   */
  private fun layoutKey(
    spec: TextSpec,
    sizes: Sizes,
    options: MeasureOptions
  ): String = listOf(
    spec.fontFamily ?: "",
    spec.fontSize.toString(),
    spec.fontWeight ?: "",
    spec.fontStyle ?: "",
    spec.lineHeight?.toString() ?: "",
    spec.letterSpacing?.toString() ?: "",
    // Case mapping follows the device locale, which can change while the app
    // runs; it only matters when there is a transform.
    spec.textTransform?.let { "$it@${Locale.getDefault().toLanguageTag()}" } ?: "",
    (spec.fontVariant ?: emptyArray()).joinToString(","),
    // The resolved sizes rather than the scaling props: they also carry the
    // system text size, which no field of `spec` does on this platform.
    sizes.key,
    spec.writingDirection ?: "",
    (spec.includeFontPadding ?: true).toString(),
    spec.textBreakStrategy ?: "",
    spec.hyphenationFrequency ?: "",
    options.maxWidth.toString(),
    (options.maxLines ?: 0.0).toString(),
    densityOf(options).toString()
  ).joinToString("_")

  // MARK: - Measurement

  private fun measureWith(
    paint: TextPaint,
    rawText: String,
    spec: TextSpec,
    options: MeasureOptions,
    density: Double,
    sizes: Sizes
  ): TextMeasurement {
    val text = transform(rawText, spec)
    val maxLines = (options.maxLines ?: 0.0).toInt()
    // RN's AT_MOST path floors the physical-pixel constraint before handing
    // it to StaticLayout. Ceil here can move a near-boundary word to the
    // previous line compared with the real <Text>.
    // In Float, as RN's dpToPx is: a Double product can floor a pixel apart.
    val width = floor(options.maxWidth.toFloat() * density.toFloat())
      .toDouble()
      .coerceIn(0.0, MAX_LAYOUT_WIDTH)
      .toInt()

    val source: CharSequence = sizes.lineHeightPx?.let { lineHeight ->
      SpannableString(text).apply {
        setSpan(
          RNLineHeightSpan(ceil(lineHeight.toDouble()).toInt()),
          0,
          text.length,
          SpannableString.SPAN_INCLUSIVE_INCLUSIVE
        )
      }
    } ?: text

    val includeFontPadding = spec.includeFontPadding ?: true
    val boring = boringMetrics(source, paint)
    val layout: Layout
    val usesIntrinsicWidth: Boolean

    if (boring != null && boring.width <= width) {
      // This is RN's fast path for simple single-line text. Its integer
      // metrics width is also the width Yoga receives and onLayout reports.
      layout = BoringLayout.make(
        source,
        paint,
        boring.width,
        Layout.Alignment.ALIGN_NORMAL,
        1f,
        0f,
        boring,
        includeFontPadding
      )
      usesIntrinsicWidth = true
    } else {
      val desiredWidth = ceil(Layout.getDesiredWidth(source, paint).toDouble())
        .coerceIn(0.0, MAX_LAYOUT_WIDTH)
        .toInt()
      val layoutWidth = minOf(desiredWidth, width)
      val builder = StaticLayout.Builder
        .obtain(source, 0, source.length, paint, layoutWidth)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setLineSpacing(0f, 1f)
        .setIncludePad(includeFontPadding)
        .setBreakStrategy(breakStrategy(spec.textBreakStrategy))
        .setHyphenationFrequency(hyphenationFrequency(spec.hyphenationFrequency))

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        builder.setUseLineSpacingFromFallbacks(true)
      }

      if (maxLines > 0) {
        builder.setMaxLines(maxLines)
        builder.setEllipsize(android.text.TextUtils.TruncateAt.END)
      }

      layout = builder.build()
      usesIntrinsicWidth = desiredWidth <= width
    }

    var widest = 0f
    var lastLineWidth = 0f
    for (line in 0 until layout.lineCount) {
      val lineWidth = layout.getLineWidth(line)
      if (lineWidth > widest) widest = lineWidth
      lastLineWidth = lineWidth
    }

    // With `TruncateAt.END` the last kept line still ends at the end of the
    // text, so a short `getLineEnd` never shows the cut. The characters the
    // ellipsis stands in for do.
    val lastLine = layout.lineCount - 1
    val didTruncate = maxLines > 0 && lastLine >= 0 && (
      layout.getEllipsisCount(lastLine) > 0 ||
        layout.getLineEnd(lastLine) < source.length
      )

    // Back to dp — the units `onLayout` reports.
    return TextMeasurement(
      // For an intrinsic layout this is the exact integer physical-pixel
      // width RN gives Yoga. For wrapped text preserve the API's useful
      // "widest laid-out line" contract rather than returning the container.
      width = (if (usesIntrinsicWidth) layout.width.toFloat() else widest) / density,
      height = layout.height / density,
      lineCount = layout.lineCount.toDouble(),
      lastLineWidth = lastLineWidth / density,
      didTruncate = didTruncate
    )
  }

  /**
   * The screen density RN converts with, not JS's `PixelRatio.get()`.
   *
   * RN's text pipeline (`PixelUtil`, `DisplayMetricsHolder`) works in the
   * screen's metrics, while `PixelRatio.get()` is the window's. They agree on
   * an ordinary phone and part ways on an external display, in desktop
   * windowing or under a density override. Sizing the font in one and the
   * box in the other would measure a font of the wrong size in the box.
   */
  @Suppress("UNUSED_PARAMETER")
  private fun densityOf(options: MeasureOptions): Double =
    PixelUtil.getDisplayMetricDensity().toDouble()

  /**
   * A line-for-line port of RN's `CustomLineHeightSpan` (0.77 and later, so
   * every version this package supports), which follows CSS: the leading is
   * split around the first font's ascent and descent, and only the
   * paragraph's first top and last bottom are pinned, so interior line boxes
   * may overlap the way they do on the web.
   *
   * The pre-0.77 span agreed with this one at ordinary sizes and parted ways
   * once `lineHeight` neared the font's own height, which is where a large
   * Android 14+ text size puts it.
   */
  private class RNLineHeightSpan(private val height: Int) : LineHeightSpan {
    override fun chooseHeight(
      text: CharSequence,
      start: Int,
      end: Int,
      spanstartv: Int,
      v: Int,
      fm: Paint.FontMetricsInt
    ) {
      val leading = height - ((-fm.ascent) + fm.descent)
      fm.ascent -= ceil(leading / 2.0f).toInt()
      fm.descent += floor(leading / 2.0f).toInt()
      if (start == 0) {
        fm.top = fm.ascent
      }
      if (end == text.length) {
        fm.bottom = fm.descent
      }
    }
  }

  // MARK: - Paint

  /**
   * Font size, line height and letter spacing in physical pixels, resolved
   * the way RN's `TextAttributeProps` resolves them for a real `<Text>`.
   */
  private class Sizes(
    /** Whole pixels: RN ceils the size and hands `ReactAbsoluteSizeSpan` an Int. */
    val fontPx: Int,
    val lineHeightPx: Float?,
    /** Ems, which is what `Paint.letterSpacing` takes. */
    val letterSpacingEm: Float?,
    /** Android's "Bold text" setting, as RN applies it; 0 when it does not. */
    val weightAdjustment: Int
  ) {
    val key: String get() =
      "${fontPx}_${lineHeightPx ?: ""}_${letterSpacingEm ?: ""}_$weightAdjustment"
  }

  /**
   * A port of `TextAttributeProps` — `setFontSize`, the `lineHeight` setter
   * and the `letterSpacing` getter.
   *
   * With scaling on, RN converts through `PixelUtil.toPixelFromSP`, which is
   * `TypedValue.applyDimension(COMPLEX_UNIT_SP)`. From Android 14 that curve is
   * nonlinear, so it is called here rather than imitated with a multiplier.
   * Only the font size honours `maxFontSizeMultiplier`: RN converts the line
   * height and letter spacing without a cap, and so does this.
   */
  private fun sizesOf(spec: TextSpec, density: Double): Sizes {
    val allowScaling = spec.allowFontScaling ?: true
    val linear = spec.fontScale?.takeIf { it > 0 }

    fun toPixels(value: Double, cap: Float): Float = when {
      // RN's toPixelFromDIP multiplies in Float; doing it in Double first can
      // land on the other side of the ceil below (9.6 at 2.8125 is one such).
      !allowScaling -> value.toFloat() * density.toFloat()
      linear != null -> {
        val scaled = value * linear * density
        (if (cap >= 1) min(scaled, value * cap * density) else scaled).toFloat()
      }
      else -> PixelUtil.toPixelFromSP(value.toFloat(), cap)
    }

    val cap = spec.maxFontSizeMultiplier?.toFloat() ?: Float.NaN
    val fontPx = ceil(toPixels(spec.fontSize, cap).toDouble()).toInt()
    return Sizes(
      fontPx = fontPx,
      lineHeightPx = spec.lineHeight?.let { toPixels(it, Float.NaN) },
      letterSpacingEm = spec.letterSpacing?.let {
        if (fontPx > 0) toPixels(it, Float.NaN) / fontPx else null
      },
      weightAdjustment = fontWeightAdjustment()
    )
  }

  /**
   * The accessibility "Bold text" setting (Android 12+), which RN 0.88 and
   * later add to the weight of every typeface it draws
   * (`ReactTypefaceUtils.applyFontWeightAdjustment`). Earlier RN ignores it, so
   * measuring with it there would come out too wide.
   */
  private fun fontWeightAdjustment(): Int {
    if (!rnAppliesFontWeightAdjustment || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return 0
    }
    val adjustment = NitroModules.applicationContext
      ?.resources?.configuration?.fontWeightAdjustment ?: 0
    return if (adjustment == Configuration.FONT_WEIGHT_ADJUSTMENT_UNDEFINED) 0 else adjustment
  }

  /** Read once: the RN in the process cannot change. */
  private val rnAppliesFontWeightAdjustment: Boolean by lazy {
    val version = ReactNativeVersion.VERSION
    val major = version["major"] as? Int ?: 0
    val minor = version["minor"] as? Int ?: 0
    major > 0 || minor >= 88
  }

  /**
   * RN's `isBoring`: fallback fonts' line spacing counts from Android 13, as
   * TextView's does, so a short single line of CJK, Thai or Devanagari gets
   * the taller extents it is drawn with. A negative width, which isBoring
   * reports for some strings, means StaticLayout instead.
   */
  private fun boringMetrics(text: CharSequence, paint: TextPaint): BoringLayout.Metrics? {
    val metrics = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      BoringLayout.isBoring(text, paint)
    } else {
      BoringLayout.isBoring(text, paint, TextDirectionHeuristics.FIRSTSTRONG_LTR, true, null)
    }
    return if (metrics == null || metrics.width < 0) null else metrics
  }

  private fun buildPaint(spec: TextSpec, sizes: Sizes): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    paint.textSize = sizes.fontPx.toFloat()
    paint.typeface = adjustWeight(resolveTypeface(spec), sizes.weightAdjustment)

    // RN applies a CustomStyleSpan whenever any font selector is present.
    // Besides resolving the Typeface, that span enables both flags below.
    // They materially change glyph advances for spaces, fallback fonts and
    // emoji, so omitting them makes width drift by several physical pixels.
    val hasFontSelector =
      spec.fontFamily != null || spec.fontWeight != null || spec.fontStyle != null
    if (hasFontSelector) {
      paint.isSubpixelText = true
      paint.isLinearText = true
    }

    sizes.letterSpacingEm?.let { paint.letterSpacing = it }

    // The same span is the only thing that carries font features, so RN draws
    // a fontVariant only when one of those selectors is set too.
    if (hasFontSelector) {
      spec.fontVariant?.let { variants ->
        val features = variants.mapNotNull { featureFor(it) }
        if (features.isNotEmpty()) paint.fontFeatureSettings = features.joinToString(", ")
      }
    }

    return paint
  }

  /**
   * Height of a glyph above the baseline, in the paint's own units.
   *
   * The obvious call, `measureText`, answers the horizontal advance — the wrong
   * dimension outright, and landing in the right ballpark is exactly what let it
   * pass for working. Android exposes no cap or x-height, so the inked bounding
   * box is as close as the platform gets; it is also precisely what RN's
   * `onTextLayout` reports here, which makes it the right answer for a library
   * whose contract is to agree with RN.
   *
   * Measuring at 100x and dividing back recovers what the integer `Rect` would
   * otherwise round away; text size scales linearly, so the factor cancels
   * exactly. iOS still reads `capHeight`/`xHeight` from the font's OS/2 table,
   * so the two platforms can differ by a fraction — a designed metric is not an
   * inked extent — but that gap is RN's own, and both now answer in height.
   */
  private fun glyphHeight(paint: TextPaint, glyph: String): Double {
    val amplified = TextPaint(paint).apply { textSize *= GLYPH_AMPLIFICATION }
    val bounds = Rect()
    amplified.getTextBounds(glyph, 0, glyph.length, bounds)
    return bounds.height() / GLYPH_AMPLIFICATION.toDouble()
  }

  /** The variants Fabric forwards on Android (`TextAttributeProps.setFontVariant`). */
  private fun featureFor(variant: String): String? = when (variant) {
    "small-caps" -> "'smcp'"
    "tabular-nums" -> "'tnum'"
    "proportional-nums" -> "'pnum'"
    "oldstyle-nums" -> "'onum'"
    "lining-nums" -> "'lnum'"
    // Locale.ROOT, or an Arabic-locale device would format the digits as ٠١.
    else -> STYLISTIC_SETS[variant]?.let { String.format(Locale.ROOT, "'ss%02d'", it) }
  }

  private fun adjustWeight(typeface: Typeface, adjustment: Int): Typeface {
    if (adjustment == 0 || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return typeface
    val weight = min(max(typeface.weight + adjustment, 1), 1000)
    return Typeface.create(typeface, weight, typeface.isItalic)
  }

  /**
   * A port of RN's `ReactTypefaceUtils.applyStyles` — the function
   * `CustomStyleSpan` calls on the very paint that measures a real `<Text>`.
   *
   * Delegating to `ReactFontManager` is the point of this function, not a
   * detail. A font shipped in `assets/fonts/` exists nowhere else and is
   * reachable only through `Typeface.createFromAsset`, which is what the
   * manager tries first. `Typeface.create(family, style)` searches the *system*
   * families, misses it, and — since it never returns null — quietly answers
   * with the default. Measuring that way yields confident numbers taken off a
   * font that is not the one being drawn, and with a `lineHeight` span pinning
   * row height the error surfaces as a whole extra or missing line rather than
   * as a visible fraction of one. For a genuine system family the manager falls
   * through to the same `Typeface.create`, so that path is unchanged.
   *
   * Note what is deliberately absent: no second `Typeface.create(base, weight,
   * italic)` layered over a named family. RN resolves a family through the
   * manager and stops there, so on Android every weight below 700 collapses to
   * the regular face. Synthesising the in-between weight here would measure a
   * font the renderer never produces.
   */
  private fun resolveTypeface(spec: TextSpec): Typeface {
    val family = spec.fontFamily
    val weight = mapWeight(spec.fontWeight)
    val italic = spec.fontStyle == "italic"
    val key = "${family ?: "default"}_${weight}_${italic}"
    typefaceCache[key]?.let { return it }

    val assets = assetManager()
    val style = ReactFontManager.TypefaceStyle(weight, italic)
    val resolved = when {
      family == null -> style.apply(Typeface.DEFAULT)
      // The same singleton RN measures and renders through, so this is not a
      // parallel font cache — it is the same Typeface instance the view gets.
      assets != null -> ReactFontManager.getInstance().getTypeface(family, style, assets)
      // No context yet, so no assets to search. Resolve locally instead of
      // through the manager, which accepts a null `AssetManager` but would then
      // cache the system fallback under this family for the rest of the
      // process — and that cache belongs to the renderer as much as to us.
      // `nearestStyle` is what the manager's own fallback passes here.
      else -> Typeface.create(family, style.nearestStyle)
    }

    // Same reasoning one layer up: an answer reached without assets is worth
    // returning, not worth keeping. Caching it would pin the fallback font past
    // the moment the real one becomes reachable.
    if (family == null || assets != null) {
      typefaceCache[key] = resolved
    }
    return resolved
  }

  /** Null until Nitro has a React context — see [resolveTypeface]. */
  private fun assetManager(): AssetManager? =
    NitroModules.applicationContext?.assets

  private fun mapWeight(weight: String?): Int = when (weight) {
    "100" -> 100
    "200" -> 200
    "300" -> 300
    "400", "normal", null -> 400
    "500" -> 500
    "600" -> 600
    "700", "bold" -> 700
    "800" -> 800
    "900" -> 900
    else -> 400
  }

  /**
   * A port of RN's `applyTextTransform`: the device locale for case mapping
   * (Turkish dotted I) and `BreakIterator` words for capitalize, so
   * "hello-world" and a word after a newline capitalize as they render.
   */
  private fun transform(text: String, spec: TextSpec): String = when (spec.textTransform) {
    "uppercase" -> text.uppercase(Locale.getDefault())
    "lowercase" -> text.lowercase(Locale.getDefault())
    "capitalize" -> {
      val words = BreakIterator.getWordInstance()
      words.setText(text)
      val result = StringBuilder(text.length)
      var start = words.first()
      var end = words.next()
      while (end != BreakIterator.DONE) {
        result.append(text.substring(start, end).replaceFirstChar { it.uppercaseChar() })
        start = end
        end = words.next()
      }
      result.toString()
    }
    else -> text
  }

  private fun breakStrategy(value: String?): Int = when (value) {
    "simple" -> Layout.BREAK_STRATEGY_SIMPLE
    "balanced" -> Layout.BREAK_STRATEGY_BALANCED
    // RN's <Text> defaults to highQuality, so this module does too.
    else -> Layout.BREAK_STRATEGY_HIGH_QUALITY
  }

  private fun hyphenationFrequency(value: String?): Int = when (value) {
    "normal" -> Layout.HYPHENATION_FREQUENCY_NORMAL
    "full" -> Layout.HYPHENATION_FREQUENCY_FULL
    else -> Layout.HYPHENATION_FREQUENCY_NONE
  }
}
