package com.margelo.nitro.pretext

import android.graphics.Typeface
import android.os.Build
import android.text.BoringLayout
import android.text.Layout
import android.text.SpannableString
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.graphics.Paint
import com.facebook.proguard.annotations.DoNotStrip
import kotlin.math.ceil
import kotlin.math.floor

/**
 * `StaticLayout` — the same class `TextView` uses. The knobs mirror
 * `ReactTextView`: `includeFontPadding` adds to the height and `breakStrategy`
 * moves the break points, so measuring without them is precise about the wrong
 * layout. `lineHeight` goes through a span because that is how RN applies it.
 */
@DoNotStrip
class PreText : HybridPreTextSpec() {

  private val typefaceCache = HashMap<String, Typeface>()

  private companion object {
    /** Matches `UNBOUNDED_WIDTH` on the JS side. */
    const val MAX_LAYOUT_WIDTH = 1_000_000.0
  }

  // MARK: - Public API

  override fun measure(
    text: String,
    spec: TextSpec,
    options: MeasureOptions
  ): TextMeasurement {
    val density = densityOf(options)
    return measureWith(buildPaint(spec, density), text, spec, options, density)
  }

  override fun measureBatch(
    texts: Array<String>,
    spec: TextSpec,
    options: MeasureOptions
  ): Array<TextMeasurement> {
    val density = densityOf(options)
    val paint = buildPaint(spec, density)
    return Array(texts.size) { i ->
      measureWith(paint, texts[i], spec, options, density)
    }
  }

  override fun getFontMetrics(spec: TextSpec): FontMetrics {
    val paint = buildPaint(spec, 1.0)
    val metrics = paint.fontMetrics
    return FontMetrics(
      ascender = (-metrics.ascent).toDouble(),
      descender = metrics.descent.toDouble(),
      xHeight = paint.measureText("x").toDouble(),
      capHeight = paint.measureText("H").toDouble(),
      lineGap = metrics.leading.toDouble(),
      lineHeight = spec.lineHeight ?: (metrics.descent - metrics.ascent).toDouble()
    )
  }

  override fun clearCache() {
    typefaceCache.clear()
  }

  // MARK: - Measurement

  private fun measureWith(
    paint: TextPaint,
    rawText: String,
    spec: TextSpec,
    options: MeasureOptions,
    density: Double
  ): TextMeasurement {
    val text = transform(rawText, spec)
    val maxLines = (options.maxLines ?: 0.0).toInt()
    // RN's AT_MOST path floors the physical-pixel constraint before handing
    // it to StaticLayout. Ceil here can move a near-boundary word to the
    // previous line compared with the real <Text>.
    val width = floor(options.maxWidth * density)
      .coerceIn(0.0, MAX_LAYOUT_WIDTH)
      .toInt()

    val source: CharSequence = spec.lineHeight?.let { lineHeight ->
      SpannableString(text).apply {
        setSpan(
          RNLineHeightSpan(
            ceil(lineHeight * scaleOf(spec) * density).toInt()
          ),
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
   * A line-for-line port of RN's `CustomLineHeightSpan`. The cascade matters:
   * pinning `top = ascent` unconditionally cancels the font padding and comes
   * out exactly 1dp short, whatever the line count.
   */
  private class RNLineHeightSpan(private val height: Int) : LineHeightSpan {
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

  private fun scaleOf(spec: TextSpec): Double {
    val value = spec.fontScale ?: 1.0
    return if (value > 0) value else 1.0
  }

  private fun buildPaint(spec: TextSpec, density: Double): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    val size = (spec.fontSize * scaleOf(spec) * density).toFloat()
    paint.textSize = size
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

    spec.letterSpacing?.let { spacing ->
      // Android wants ems, RN gives dp; density cancels out in the ratio.
      if (spec.fontSize > 0) {
        paint.letterSpacing = (spacing / (spec.fontSize * scaleOf(spec))).toFloat()
      }
    }

    spec.fontVariant?.let { variants ->
      val features = variants.mapNotNull { featureFor(it) }
      if (features.isNotEmpty()) paint.fontFeatureSettings = features.joinToString(", ")
    }

    return paint
  }

  private fun featureFor(variant: String): String? = when (variant) {
    "small-caps" -> "'smcp'"
    "tabular-nums" -> "'tnum'"
    "proportional-nums" -> "'pnum'"
    "oldstyle-nums" -> "'onum'"
    "lining-nums" -> "'lnum'"
    else -> null
  }

  private fun resolveTypeface(spec: TextSpec): Typeface {
    val family = spec.fontFamily
    val weight = mapWeight(spec.fontWeight)
    val italic = spec.fontStyle == "italic"
    val key = "${family ?: "default"}_${weight}_${italic}"
    typefaceCache[key]?.let { return it }

    val base = if (family != null) {
      Typeface.create(family, Typeface.NORMAL)
    } else {
      Typeface.DEFAULT
    }

    val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Typeface.create(base, weight, italic)
    } else {
      val style = when {
        weight >= 700 && italic -> Typeface.BOLD_ITALIC
        weight >= 700 -> Typeface.BOLD
        italic -> Typeface.ITALIC
        else -> Typeface.NORMAL
      }
      Typeface.create(base, style)
    }

    typefaceCache[key] = resolved
    return resolved
  }

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
