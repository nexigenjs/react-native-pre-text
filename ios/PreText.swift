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
      descender: Double(font.descender),
      xHeight: Double(font.xHeight),
      capHeight: Double(font.capHeight),
      lineGap: Double(font.leading),
      lineHeight: spec.lineHeight ?? Double(font.lineHeight)
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
    let maxLines = Int(options.maxLines ?? 0)
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
      NSAttributedString(string: text, attributes: attributes)
    )
    layout.storage.addLayoutManager(manager)

    manager.ensureLayout(for: container)

    var lineCount = 0
    var widest: CGFloat = 0
    var lastLineWidth: CGFloat = 0
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
        index = NSMaxRange(lineRange)
        if lineRange.length == 0 { break }
      }
    }

    let used = manager.usedRect(for: container)
    let didTruncate =
      maxLines > 0 && glyphRange.length < manager.numberOfGlyphs

    let scale = CGFloat(options.pixelRatio ?? 0)

    return TextMeasurement(
      width: Double(pixelCeil(widest, scale)),
      height: Double(pixelCeil(used.height, scale)),
      lineCount: Double(lineCount),
      lastLineWidth: Double(pixelCeil(lastLineWidth, scale)),
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
  private func pixelCeil(_ value: CGFloat, _ scale: CGFloat) -> CGFloat {
    guard scale > 0, value.isFinite, value > 0 else { return value }
    return ceil(value * scale) / scale
  }

  // MARK: - Attributes

  private func attributes(for spec: TextSpec) -> [NSAttributedString.Key: Any] {
    let font = resolveFont(spec)
    var attributes: [NSAttributedString.Key: Any] = [.font: font]

    let paragraph = NSMutableParagraphStyle()
    if let lineHeight = spec.lineHeight, lineHeight > 0 {
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

    if let letterSpacing = spec.letterSpacing, letterSpacing != 0 {
      attributes[.kern] = CGFloat(letterSpacing)
    }

    return attributes
  }

  private func transformed(_ text: String, spec: TextSpec) -> String {
    switch spec.textTransform {
    case "uppercase": return text.uppercased()
    case "lowercase": return text.lowercased()
    case "capitalize": return text.capitalized
    default: return text
    }
  }

  // MARK: - Font resolution

  private func scale(_ spec: TextSpec) -> CGFloat {
    let value = spec.fontScale ?? 1
    return value > 0 ? CGFloat(value) : 1
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

  private func resolveFont(_ spec: TextSpec) -> UIFont {
    let key = cacheKey(spec)
    if let cached = fontCache[key] {
      return cached
    }

    let size = CGFloat(spec.fontSize) * scale(spec)
    let weight = mapWeight(spec.fontWeight)
    let italic = spec.fontStyle == "italic"

    var font: UIFont
    if let family = spec.fontFamily,
       family != "System",
       family != "system",
       let named = UIFont(name: family, size: size) {
      font = named
    } else {
      font = UIFont.systemFont(ofSize: size, weight: weight)
    }

    var traits: UIFontDescriptor.SymbolicTraits = []
    if italic { traits.insert(.traitItalic) }
    // A named family carries its own weight — only synthesise what it lacks.
    if weight >= .semibold, spec.fontFamily != nil,
       !font.fontDescriptor.symbolicTraits.contains(.traitBold) {
      traits.insert(.traitBold)
    }
    if !traits.isEmpty,
       let descriptor = font.fontDescriptor.withSymbolicTraits(
        font.fontDescriptor.symbolicTraits.union(traits)
       ) {
      font = UIFont(descriptor: descriptor, size: size)
    }

    if let variants = spec.fontVariant, !variants.isEmpty {
      font = applyVariants(variants, to: font, size: size)
    }

    fontCache[key] = font
    return font
  }

  private func applyVariants(
    _ variants: [String],
    to font: UIFont,
    size: CGFloat
  ) -> UIFont {
    var settings: [[UIFontDescriptor.FeatureKey: Int]] = []
    for variant in variants {
      switch variant {
      case "small-caps":
        settings.append([
          .type: kLowerCaseType,
          .selector: kLowerCaseSmallCapsSelector,
        ])
      case "tabular-nums":
        settings.append([
          .type: kNumberSpacingType,
          .selector: kMonospacedNumbersSelector,
        ])
      case "proportional-nums":
        settings.append([
          .type: kNumberSpacingType,
          .selector: kProportionalNumbersSelector,
        ])
      case "oldstyle-nums":
        settings.append([
          .type: kNumberCaseType,
          .selector: kLowerCaseNumbersSelector,
        ])
      case "lining-nums":
        settings.append([
          .type: kNumberCaseType,
          .selector: kUpperCaseNumbersSelector,
        ])
      default:
        continue
      }
    }
    guard !settings.isEmpty else { return font }
    let descriptor = font.fontDescriptor.addingAttributes([
      .featureSettings: settings
    ])
    return UIFont(descriptor: descriptor, size: size)
  }

  private func mapWeight(_ weight: String?) -> UIFont.Weight {
    switch weight {
    case "100": return .ultraLight
    case "200": return .thin
    case "300": return .light
    case "400", "normal", .none: return .regular
    case "500": return .medium
    case "600": return .semibold
    case "700", "bold": return .bold
    case "800": return .heavy
    case "900": return .black
    default: return .regular
    }
  }
}
