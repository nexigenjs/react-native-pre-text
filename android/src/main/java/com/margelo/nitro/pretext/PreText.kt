package com.margelo.nitro.pretext

import android.content.res.AssetManager
import android.graphics.Typeface
import android.os.Build
import android.text.BoringLayout
import android.text.Layout
import android.text.SpannableString
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.graphics.Paint
import android.graphics.Rect
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.modules.systeminfo.ReactNativeVersion
import com.facebook.react.uimanager.PixelUtil
import com.margelo.nitro.NitroModules
import kotlin.math.ceil
import kotlin.math.floor
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
    /** Matches `UNBOUNDED_WIDTH` on the JS side. */
    const val MAX_LAYOUT_WIDTH = 1_000_000.0

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
      lineHeight = (sizes.lineHeightPx ?: (metrics.descent - metrics.ascent)) / density
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
    spec.textTransform ?: "",
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
    (options.pixelRatio ?: 1.0).toString()
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
    val width = floor(options.maxWidth * density)
      .coerceIn(0.0, MAX_LAYOUT_WIDTH)
      .toInt()

    val source: CharSequence = sizes.lineHeightPx?.let { lineHeight ->
      SpannableString(text).apply {
        setSpan(
          lineHeightSpan(ceil(lineHeight.toDouble()).toInt()),
          0,
          text.length,
          SpannableString.SPAN_INCLUSIVE_INCLUSIVE
        )
      }
    } ?: text

    val includeFontPadding = spec.includeFontPadding ?: true
    val boring = BoringLayout.isBoring(source, paint)
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

    val didTruncate =
      maxLines > 0 && layout.getLineEnd(layout.lineCount - 1) < source.length

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

  private fun densityOf(options: MeasureOptions): Double {
    val value = options.pixelRatio ?: 1.0
    return if (value > 0) value else 1.0
  }

  /**
   * RN's `CustomLineHeightSpan`, in whichever form the host app's RN ships.
   *
   * RN 0.77 replaced the span (facebook/react-native#47271). At ordinary sizes
   * the two agree, so a corpus at the default text size cannot tell them apart.
   * They part ways once `lineHeight` gets close to the font's own height, which
   * is exactly where a large system text size puts it on Android 14+: the font
   * grows faster than the line height there, and the old cascade then leaves
   * interior lines at the font's natural height instead of the one asked for.
   */
  private fun lineHeightSpan(height: Int): LineHeightSpan =
    if (usesCssLineHeight) CssLineHeightSpan(height) else LegacyLineHeightSpan(height)

  /** RN 0.77 and later. Read once: the RN in the process cannot change. */
  private val usesCssLineHeight: Boolean by lazy {
    val version = ReactNativeVersion.VERSION
    val major = version["major"] as? Int ?: 0
    val minor = version["minor"] as? Int ?: 0
    major > 0 || minor >= 77
  }

  /**
   * A line-for-line port of RN 0.77+'s `CustomLineHeightSpan`, which follows
   * CSS: the leading is split around the first font's ascent and descent, and
   * only the paragraph's first top and last bottom are pinned, so interior
   * line boxes may overlap the way they do on the web.
   */
  private class CssLineHeightSpan(private val height: Int) : LineHeightSpan {
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

  /**
   * A line-for-line port of `CustomLineHeightSpan` before RN 0.77. The cascade
   * matters: pinning `top = ascent` unconditionally cancels the font padding
   * and comes out exactly 1dp short, whatever the line count.
   */
  private class LegacyLineHeightSpan(private val height: Int) : LineHeightSpan {
    override fun chooseHeight(
      text: CharSequence?,
      start: Int,
      end: Int,
      spanstartv: Int,
      v: Int,
      fm: Paint.FontMetricsInt
    ) {
      if (fm.descent > height) {
        fm.descent = minOf(height, fm.descent)
        fm.bottom = fm.descent
        fm.ascent = -height + fm.descent
        fm.top = fm.ascent
      } else if (-fm.ascent + fm.descent > height) {
        fm.bottom = fm.descent
        fm.ascent = -height + fm.descent
        fm.top = fm.ascent
      } else if (-fm.ascent + fm.bottom > height) {
        fm.top = fm.ascent
        fm.bottom = fm.ascent + height
      } else if (-fm.top + fm.bottom > height) {
        fm.top = fm.bottom - height
      } else {
        val additional = height - (-fm.top + fm.bottom)
        fm.top -= ceil(additional / 2.0).toInt()
        fm.bottom += floor(additional / 2.0).toInt()
        fm.ascent = fm.top
        fm.descent = fm.bottom
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
    val letterSpacingEm: Float?
  ) {
    val key: String get() = "${fontPx}_${lineHeightPx ?: ""}_${letterSpacingEm ?: ""}"
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
      !allowScaling -> (value * density).toFloat()
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
      }
    )
  }

  private fun buildPaint(spec: TextSpec, sizes: Sizes): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    paint.textSize = sizes.fontPx.toFloat()
    paint.typeface = resolveTypeface(spec)

    // RN applies a CustomStyleSpan whenever any font selector is present.
    // Besides resolving the Typeface, that span enables both flags below.
    // They materially change glyph advances for spaces, fallback fonts and
    // emoji, so omitting them makes width drift by several physical pixels.
    if (
      spec.fontFamily != null ||
      spec.fontWeight != null ||
      spec.fontStyle != null
    ) {
      paint.isSubpixelText = true
      paint.isLinearText = true
    }

    sizes.letterSpacingEm?.let { paint.letterSpacing = it }

    spec.fontVariant?.let { variants ->
      val features = variants.mapNotNull { featureFor(it) }
      if (features.isNotEmpty()) paint.fontFeatureSettings = features.joinToString(", ")
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

  private fun featureFor(variant: String): String? = when (variant) {
    "small-caps" -> "'smcp'"
    "tabular-nums" -> "'tnum'"
    "proportional-nums" -> "'pnum'"
    "oldstyle-nums" -> "'onum'"
    "lining-nums" -> "'lnum'"
    else -> null
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

  private fun transform(text: String, spec: TextSpec): String = when (spec.textTransform) {
    "uppercase" -> text.uppercase()
    "lowercase" -> text.lowercase()
    "capitalize" -> text.split(" ").joinToString(" ") { word ->
      word.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
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
