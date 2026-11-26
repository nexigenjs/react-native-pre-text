import CoreText
import Foundation
import UIKit

/// Configured to mirror `RCTTextShadowView`. Diverging from RN's own setup
/// shows up directly as a wrong height, so copy it rather than improve on it.
class PreText: HybridPreTextSpec {
  private var fontCache: [String: UIFont] = [:]

  /// Per generation. Two are live at once, so the ceiling is 1024 entries.
  private static let cacheCap = 512

  /// Measurement cache, two generations giving each entry one second chance.
  ///
  /// Reads check the newer generation, then the older; a hit in the older one
  /// promotes it back. When the newer fills, it ages wholesale into the older
  /// slot and the previous older generation is dropped. So what survives is
  /// what was *read*, not what was recently written.
  ///
  /// This is a deliberate approximation of LRU rather than the real thing —
  /// React Native's own `TextMeasureCache` keeps a strict LRU with a linked
  /// list, which is exact and equally O(1). The trade taken here is a coarser
  /// policy for a much smaller one: no list to maintain, two dictionaries and
  /// one counter. The costs are real and accepted — the ceiling is 2x the cap
  /// rather than the cap, there is no recency ordering *within* a generation,
  /// and an entry written just before an aging gets less grace than one written
  /// just after. With a list window of tens of rows against a 512 cap, aging is
  /// rare enough that none of that is reachable in practice.
  ///
  /// None of it can change a result. The key covers everything the platform
  /// reads, so an entry is only ever returned for inputs that would have
  /// produced it — this buys time, never accuracy.
  private var hotCache: [MeasureKey: TextMeasurement] = [:]
  private var coldCache: [MeasureKey: TextMeasurement] = [:]

  /// The layout graph and both caches are shared mutable state, while Nitro
  /// makes no promise about which thread calls in. Uncontended locking costs
  /// tens of nanoseconds against a measurement three orders of magnitude
  /// larger, so serialising is free here in a way that a data race is not.
  private let lock = NSLock()

  private lazy var engine = LayoutEngine()

  private struct MeasureKey: Hashable {
    let text: String
    let spec: String
    let maxWidth: Double
    let maxLines: Double
    let pixelRatio: Double
  }

  /// One TextKit graph, reused across calls.
  ///
  /// Allocating `NSTextStorage`, `NSTextContainer` and `NSLayoutManager` per
  /// call dominates a sub-millisecond measurement — TextKit's line breaking is
  /// the cheap part. Reuse is invisible in the output: the same engine still
  /// lays out the same whole string against the same container.
  private final class LayoutEngine {
    let storage = NSTextStorage()
    let container = NSTextContainer(size: .zero)
    let manager = NSLayoutManager()

    init() {
      // RN renders with no inset; leaving TextKit's default 5pt padding here
      // would make every measurement 10pt narrower than the real thing.
      container.lineFragmentPadding = 0
      manager.usesFontLeading = false
      manager.addTextContainer(container)
    }
  }

  // MARK: - Public API

  func measure(
    text: String,
    spec: TextSpec,
    options: MeasureOptions
  ) throws -> TextMeasurement {
    lock.lock()
    defer { lock.unlock() }

    return cached(text: text, spec: spec, specKey: layoutKey(spec), options: options) {
      self.attributes(for: spec)
    }
  }

  func measureBatch(
    texts: [String],
    spec: TextSpec,
    options: MeasureOptions
  ) throws -> [TextMeasurement] {
    lock.lock()
    defer { lock.unlock() }

    let specKey = layoutKey(spec)
    // Resolved at most once for the batch, and not at all when every text is
    // already cached.
    var resolved: [NSAttributedString.Key: Any]?
    let attributes: () -> [NSAttributedString.Key: Any] = {
      if let existing = resolved {
        return existing
      }
      let built = self.attributes(for: spec)
      resolved = built
      return built
    }

    return texts.map { text in
      cached(text: text, spec: spec, specKey: specKey, options: options, attributes: attributes)
    }
  }

  func getFontMetrics(spec: TextSpec) throws -> FontMetrics {
    lock.lock()
    defer { lock.unlock() }

    let font = resolveFont(spec)
    return FontMetrics(
      ascender: Double(font.ascender),
      // UIKit reports the descender as a negative offset from the baseline;
      // Android's `descent` is a positive distance. Both platforms answer as a
      // distance, so `ascender + descender` is the font's height on either.
      descender: -Double(font.descender),
      xHeight: Double(font.xHeight),
      capHeight: Double(font.capHeight),
      lineGap: Double(font.leading),
      // Scaled like the font it sits next to, or the two disagree as soon as
      // the system text size moves off 1.
      // A lineHeight of 0 or less is no lineHeight, to measure() and to RN.
      lineHeight: spec.lineHeight
        .flatMap { $0 > 0 && $0.isFinite ? $0 * Double(scale(spec)) : nil }
        ?? Double(font.lineHeight)
    )
  }

  func clearCache() throws {
    lock.lock()
    defer { lock.unlock() }

    fontCache.removeAll()
    hotCache.removeAll()
    coldCache.removeAll()
  }

  // MARK: - Cache

  /// Caller must hold `lock`.
  private func cached(
    text: String,
    spec: TextSpec,
    specKey: String,
    options: MeasureOptions,
    attributes: () -> [NSAttributedString.Key: Any]
  ) -> TextMeasurement {
    let key = MeasureKey(
      text: text,
      spec: specKey,
      maxWidth: options.maxWidth,
      maxLines: options.maxLines ?? 0,
      pixelRatio: options.pixelRatio ?? 0
    )

    if let hit = hotCache[key] {
      return hit
    }
    if let hit = coldCache[key] {
      // Promote, so something still in use survives the next aging.
      hotCache[key] = hit
      return hit
    }

    let result = measurement(
      for: transformed(text, spec: spec),
      attributes: attributes(),
      options: options
    )

    hotCache[key] = result
    if hotCache.count >= Self.cacheCap {
      coldCache = hotCache
      hotCache = [:]
    }
    return result
  }

  /// Everything that can move a break or change a line's height on iOS.
  ///
  /// Wider than `cacheKey`, which only has to identify a `UIFont`:
  /// `lineHeight` and `letterSpacing` resolve the same font but measure
  /// differently. Android-only fields are left out deliberately — folding them
  /// in would split entries that produce identical results here.
  private func layoutKey(_ spec: TextSpec) -> String {
    return [
      cacheKey(spec),
      spec.lineHeight.map { String($0) } ?? "",
      spec.letterSpacing.map { String($0) } ?? "",
      spec.textTransform ?? "",
      spec.writingDirection ?? "",
    ].joined(separator: "_")
  }

  // MARK: - Measurement

  private func measurement(
    for text: String,
    attributes: [NSAttributedString.Key: Any],
    options: MeasureOptions
  ) -> TextMeasurement {
    // `Int(_:)` traps on NaN, infinity and anything past Int's range, and a
    // trap here takes the whole app down. JS already sends a whole number or
    // 0; this is the backstop.
    let requested = options.maxLines ?? 0
    let maxLines = requested.isFinite && requested >= 1
      ? Int(min(requested, Double(Int32.max)))
      : 0
    // RN measures an empty string as the placeholder "I" in the same
    // attributes and then zeroes the width (`ensurePlaceholderIfEmpty` in
    // TextLayoutManager.mm): one line of the style's height. An empty storage
    // would instead lay out an extra line fragment in TextKit's default font.
    let isEmpty = text.isEmpty
    let laidOut = isEmpty ? "I" : text
    let layout = engine
    let container = layout.container
    let manager = layout.manager

    // `lineFragmentPadding` and `usesFontLeading` are set once, in the engine's
    // initialiser — only what varies per call is assigned here.
    container.size = CGSize(
      width: options.maxWidth,
      height: .greatestFiniteMagnitude
    )
    container.lineBreakMode = maxLines > 0 ? .byTruncatingTail : .byClipping
    container.maximumNumberOfLines = maxLines
    // RN constructs and post-processes its text storage before attaching the
    // layout manager. Detach while replacing the attributed string to preserve
    // that order; attaching first changes fallback-font metrics (notably Thai).
    if layout.storage.layoutManagers.contains(manager) {
      layout.storage.removeLayoutManager(manager)
    }
    layout.storage.setAttributedString(
      NSAttributedString(string: laidOut, attributes: attributes)
    )
    layout.storage.addLayoutManager(manager)

    manager.ensureLayout(for: container)

    var lineCount = 0
    var widest: CGFloat = 0
    var lastLineWidth: CGFloat = 0
    var lastLineStart = 0
    var limitedHeight: CGFloat = 0
    let glyphRange = manager.glyphRange(for: container)

    if glyphRange.length > 0 {
      var index = glyphRange.location
      while index < NSMaxRange(glyphRange) {
        var lineRange = NSRange(location: 0, length: 0)
        let rect = manager.lineFragmentUsedRect(
          forGlyphAt: index,
          effectiveRange: &lineRange
        )
        lineCount += 1
        widest = max(widest, rect.width)
        lastLineWidth = rect.width
        lastLineStart = index
        if lineCount <= maxLines {
          limitedHeight = rect.maxY
        }
        index = NSMaxRange(lineRange)
        if lineRange.length == 0 { break }
      }
    }

    var height = manager.usedRect(for: container).height
    // RCTTextLayoutManager.mm does not trust `usedRect` once a line limit is
    // set: with N lines and an empty line N+1 (text ending in "\n") TextKit
    // reports N+1. RN sums the kept lines instead, adding the extra line
    // fragment only when fewer than N lines exist.
    if maxLines > 0 {
      if lineCount < maxLines {
        limitedHeight += manager.extraLineFragmentUsedRect.height
      }
      height = limitedHeight
    }
    // With `byTruncatingTail` TextKit still places every glyph in the
    // container, so the glyph range alone never shows the cut. The truncated
    // range of the last kept line does.
    let didTruncate =
      maxLines > 0 && lineCount > 0 && (
        manager.truncatedGlyphRange(inLineFragmentForGlyphAt: lastLineStart)
          .location != NSNotFound
          || glyphRange.length < manager.numberOfGlyphs
      )

    let scale = CGFloat(options.pixelRatio ?? 0)
    let epsilon = options.roundingEpsilon ?? 0

    return TextMeasurement(
      width: isEmpty ? 0 : Double(pixelCeil(widest, scale, epsilon)),
      height: Double(pixelCeil(height, scale, epsilon)),
      lineCount: Double(lineCount),
      lastLineWidth: isEmpty ? 0 : Double(pixelCeil(lastLineWidth, scale, epsilon)),
      didTruncate: didTruncate
    )
  }

  /// React Native rounds a text size **up** to the next whole device pixel
  /// before Yoga ever sees it. `RCTTextLayoutManager.mm` does
  ///
  ///     ceil(size * pointScaleFactor) / pointScaleFactor
  ///
  /// and `ParagraphShadowNode.cpp` repeats it, nudging by 0.01 first, with the
  /// comment "Rounding to *next* value on the pixel grid" — so it is policy,
  /// not an accident.
  ///
  /// Returning TextKit's raw fractional value therefore lands short of
  /// `onLayout` by up to one pixel: 0.333 pt at 3x, 0.5 pt at 2x. Always short,
  /// never over, because the platform ceils rather than rounds. Applying the
  /// same step is what makes `measure()` equal `onLayout` instead of merely
  /// approaching it.
  ///
  /// RN 0.88 nudges first (`internal_roundTextMeasurementToPixelGrid`, in
  /// Float): `ceil((size + 0.001) * scale) / scale`, so a height that lands
  /// exactly on the grid, as any integer lineHeight does, goes up a pixel.
  /// The JS layer passes that epsilon only to the RN versions that apply it.
  private func pixelCeil(_ value: CGFloat, _ scale: CGFloat, _ epsilon: Double) -> CGFloat {
    guard scale > 0, value.isFinite, value > 0 else { return value }
    guard epsilon > 0 else { return ceil(value * scale) / scale }
    let factor = Float(scale)
    return CGFloat(ceil((Float(value) + Float(epsilon)) * factor) / factor)
  }

  // MARK: - Attributes

  private func attributes(for spec: TextSpec) -> [NSAttributedString.Key: Any] {
    let font = resolveFont(spec)
    var attributes: [NSAttributedString.Key: Any] = [.font: font]

    let paragraph = NSMutableParagraphStyle()
    if let lineHeight = spec.lineHeight, lineHeight > 0, lineHeight.isFinite {
      let scaled = CGFloat(lineHeight) * scale(spec)
      paragraph.minimumLineHeight = scaled
      paragraph.maximumLineHeight = scaled

      if scaled >= font.lineHeight {
        attributes[.baselineOffset] = (scaled - font.lineHeight) / 2
      }
    }
    switch spec.writingDirection {
    case "ltr": paragraph.baseWritingDirection = .leftToRight
    case "rtl": paragraph.baseWritingDirection = .rightToLeft
    default: paragraph.baseWritingDirection = .natural
    }
    attributes[.paragraphStyle] = paragraph

    // RN sets NSKern for any letterSpacing the style gives, 0 included, and a
    // kern of 0 switches the font's pair kerning off. Skipping it for 0 leaves
    // kerning on and measures narrower than the screen draws.
    if let letterSpacing = spec.letterSpacing, letterSpacing.isFinite {
      attributes[.kern] = CGFloat(letterSpacing)
    }

    return attributes
  }

  private func transformed(_ text: String, spec: TextSpec) -> String {
    switch spec.textTransform {
    case "uppercase": return text.uppercased()
    case "lowercase": return text.lowercased()
    case "capitalize": return capitalize(text)
    default: return text
    }
  }

  /// RN's `capitalizeText`: split on spaces only, capitalise each token, but
  /// lowercase one that starts with a digit ("3D-printed" → "3d-printed").
  private func capitalize(_ text: String) -> String {
    let numbers = NumberFormatter()
    return text.components(separatedBy: " ").map { word in
      if let first = word.first, numbers.number(from: String(first)) == nil {
        return word.capitalized
      }
      return word.lowercased()
    }.joined(separator: " ")
  }

  // MARK: - Font resolution

  /// RN's `RCTEffectiveFontSizeMultiplierFromTextAttributes`: 1 with scaling
  /// off, otherwise the system multiplier, capped only by a
  /// `maxFontSizeMultiplier` of 1 or more. It applies to the font size and the
  /// line height; `letterSpacing` stays unscaled, as RN leaves `NSKern` alone.
  private func scale(_ spec: TextSpec) -> CGFloat {
    guard spec.allowFontScaling ?? true else { return 1 }
    let value = spec.fontScale ?? 1
    let multiplier = value > 0 ? CGFloat(value) : 1
    if let cap = spec.maxFontSizeMultiplier, cap >= 1 {
      // `fminf`, as RN calls it: both sides narrowed to Float first, so a cap
      // of 1.2 becomes 1.2000000477 there and must here too.
      return CGFloat(Swift.min(Float(cap), Float(multiplier)))
    }
    return multiplier
  }

  private func cacheKey(_ spec: TextSpec) -> String {
    let variants = (spec.fontVariant ?? []).joined(separator: ",")
    return [
      spec.fontFamily ?? "System",
      String(spec.fontSize),
      spec.fontWeight ?? "normal",
      spec.fontStyle ?? "normal",
      String(Double(scale(spec))),
      variants,
    ].joined(separator: "_")
  }

  /// A port of RN's `RCTFontWithFontProperties` (RCTFontUtils.mm).
  ///
  /// The family goes through `UIFont.fontNames(forFamilyName:)` and the face
  /// is the one whose weight, read from its name, is closest to the one asked
  /// for. That lookup is also what expo-font hooks to serve its aliases, so a
  /// family such as `Inter_600SemiBold` resolves here as it does on screen.
  /// No weight or italic is synthesised for a named family: RN draws the
  /// nearest real face.
  private func resolveFont(_ spec: TextSpec) -> UIFont {
    let key = cacheKey(spec)
    if let cached = fontCache[key] {
      return cached
    }

    let size = CGFloat(spec.fontSize) * scale(spec)
    let weight = mapWeight(spec.fontWeight)
    let italic = spec.fontStyle == "italic"
    let family = spec.fontFamily ?? ""

    var font: UIFont?
    if let design = Self.systemDesigns[family.lowercased()] {
      let base = systemFont(size: size, weight: weight, italic: italic, condensed: false)
      font = base.fontDescriptor.withDesign(design)
        .map { UIFont(descriptor: $0, size: size) } ?? base
    } else if family.isEmpty || family == Self.systemFamily {
      font = systemFont(size: size, weight: weight, italic: italic, condensed: false)
    } else {
      var names = UIFont.fontNames(forFamilyName: family)
      var target = weight
      if names.isEmpty {
        // A face name rather than a family ("Helvetica-Light"): its family's
        // faces are the candidates. RN then writes `(weight != 0) ?: …`, which
        // keeps a regular request at the named face's own weight and turns any
        // other into 1.0, the heaviest face. Repeated as written.
        if let named = UIFont(name: family, size: size) {
          names = UIFont.fontNames(forFamilyName: named.familyName)
          target = weight != .regular ? UIFont.Weight(rawValue: 1.0) : rnWeight(of: named)
          font = named
        } else {
          font = systemFont(
            size: size,
            weight: weight,
            italic: italic,
            condensed: family == "SystemCondensed"
          )
        }
      }
      if !names.isEmpty {
        var closest = CGFloat.infinity
        for name in names {
          guard let match = UIFont(name: name, size: size),
                match.fontDescriptor.symbolicTraits.contains(.traitItalic) == italic
          else { continue }
          let candidate = rnWeight(of: match).rawValue
          if abs(candidate - target.rawValue) < abs(closest - target.rawValue) {
            font = match
            closest = candidate
          }
        }
        if font == nil {
          // Single-face families such as Zapfino: the first face, whatever it is.
          font = UIFont(name: names[0], size: size)
        }
      }
    }

    var resolved = font ?? systemFont(size: size, weight: weight, italic: italic, condensed: false)
    if let variants = spec.fontVariant, !variants.isEmpty {
      resolved = applyVariants(variants, to: resolved, size: size)
    }

    fontCache[key] = resolved
    return resolved
  }

  /// RN's `RCTDefaultFontWithFontProperties`: the system font at the weight,
  /// with italic and condensed added as traits.
  private func systemFont(
    size: CGFloat,
    weight: UIFont.Weight,
    italic: Bool,
    condensed: Bool
  ) -> UIFont {
    let font = UIFont.systemFont(ofSize: size, weight: weight)
    guard italic || condensed else { return font }
    var traits = font.fontDescriptor.symbolicTraits
    if italic { traits.insert(.traitItalic) }
    if condensed { traits.insert(.traitCondensed) }
    guard let descriptor = font.fontDescriptor.withSymbolicTraits(traits) else { return font }
    return UIFont(descriptor: descriptor, size: size)
  }

  /// The family name RN treats as "the system font".
  private static let systemFamily = UIFont.systemFont(ofSize: 14).familyName

  /// RN's `RCTGetFontDescriptorSystemDesign`: CSS generic families.
  private static let systemDesigns: [String: UIFontDescriptor.SystemDesign] = [
    "system-ui": .default,
    "ui-sans-serif": .default,
    "ui-serif": .serif,
    "ui-rounded": .rounded,
    "ui-monospace": .monospaced,
  ]

  /// RN's `RCTGetFontWeight`: the weight a face's name ends in, checked in this
  /// order, else the font's own weight trait.
  private func rnWeight(of font: UIFont) -> UIFont.Weight {
    let name = font.fontName.lowercased()
    for (suffix, weight) in Self.weightSuffixes where name.hasSuffix(suffix) {
      return weight
    }
    let traits = CTFontCopyTraits(font as CTFont) as NSDictionary
    let value = (traits[kCTFontWeightTrait as String] as? NSNumber)?.doubleValue ?? 0
    return UIFont.Weight(rawValue: CGFloat(value))
  }

  private static let weightSuffixes: [(String, UIFont.Weight)] = [
    ("normal", .regular),
    ("ultralight", .ultraLight),
    ("thin", .thin),
    ("light", .light),
    ("regular", .regular),
    ("medium", .medium),
    ("semibold", .semibold),
    ("demibold", .semibold),
    ("extrabold", .heavy),
    ("ultrabold", .heavy),
    ("bold", .bold),
    ("heavy", .heavy),
    ("black", .black),
  ]

  /// RN's `RCTFontFeatures`: a fixed order, whatever order the style lists.
  private func applyVariants(
    _ variants: [String],
    to font: UIFont,
    size: CGFloat
  ) -> UIFont {
    let requested = Set(variants)
    let settings = Self.featureOrder.compactMap { entry in
      requested.contains(entry.0)
        ? [UIFontDescriptor.FeatureKey.type: entry.1, .selector: entry.2]
        : nil
    }
    guard !settings.isEmpty else { return font }
    let descriptor = font.fontDescriptor.addingAttributes([
      .featureSettings: settings
    ])
    return UIFont(descriptor: descriptor, size: size)
  }

  private static let featureOrder: [(String, Int, Int)] = [
    ("small-caps", kLowerCaseType, kLowerCaseSmallCapsSelector),
    ("oldstyle-nums", kNumberCaseType, kLowerCaseNumbersSelector),
    ("lining-nums", kNumberCaseType, kUpperCaseNumbersSelector),
    ("tabular-nums", kNumberSpacingType, kMonospacedNumbersSelector),
    ("proportional-nums", kNumberSpacingType, kProportionalNumbersSelector),
    ("stylistic-one", kStylisticAlternativesType, kStylisticAltOneOnSelector),
    ("stylistic-two", kStylisticAlternativesType, kStylisticAltTwoOnSelector),
    ("stylistic-three", kStylisticAlternativesType, kStylisticAltThreeOnSelector),
    ("stylistic-four", kStylisticAlternativesType, kStylisticAltFourOnSelector),
    ("stylistic-five", kStylisticAlternativesType, kStylisticAltFiveOnSelector),
    ("stylistic-six", kStylisticAlternativesType, kStylisticAltSixOnSelector),
    ("stylistic-seven", kStylisticAlternativesType, kStylisticAltSevenOnSelector),
    ("stylistic-eight", kStylisticAlternativesType, kStylisticAltEightOnSelector),
    ("stylistic-nine", kStylisticAlternativesType, kStylisticAltNineOnSelector),
    ("stylistic-ten", kStylisticAlternativesType, kStylisticAltTenOnSelector),
    ("stylistic-eleven", kStylisticAlternativesType, kStylisticAltElevenOnSelector),
    ("stylistic-twelve", kStylisticAlternativesType, kStylisticAltTwelveOnSelector),
    ("stylistic-thirteen", kStylisticAlternativesType, kStylisticAltThirteenOnSelector),
    ("stylistic-fourteen", kStylisticAlternativesType, kStylisticAltFourteenOnSelector),
    ("stylistic-fifteen", kStylisticAlternativesType, kStylisticAltFifteenOnSelector),
    ("stylistic-sixteen", kStylisticAlternativesType, kStylisticAltSixteenOnSelector),
    ("stylistic-seventeen", kStylisticAlternativesType, kStylisticAltSeventeenOnSelector),
    ("stylistic-eighteen", kStylisticAlternativesType, kStylisticAltEighteenOnSelector),
    ("stylistic-nineteen", kStylisticAlternativesType, kStylisticAltNineteenOnSelector),
    ("stylistic-twenty", kStylisticAlternativesType, kStylisticAltTwentyOnSelector),
  ]

  /// RN's `RCTUIFontWeightFromInteger`: round to the nearest hundred, so 550
  /// or a numeric 600 land where RN puts them.
  private func mapWeight(_ weight: String?) -> UIFont.Weight {
    let value: Int
    switch weight {
    case .none, "normal": value = 400
    case "bold": value = 700
    default: value = Int(weight ?? "") ?? 400
    }
    let weights: [UIFont.Weight] = [
      .ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy, .black,
    ]
    let index = Swift.min(Swift.max((value + 50) / 100 - 1, 0), weights.count - 1)
    return weights[index]
  }
}
