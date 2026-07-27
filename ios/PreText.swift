import Foundation
import UIKit

/// Configured to mirror `RCTTextShadowView`. Diverging from RN's own setup
/// shows up directly as a wrong height, so copy it rather than improve on it.
class PreText: HybridPreTextSpec {
  private var fontCache: [String: UIFont] = [:]

  // MARK: - Public API

  func measure(
    text: String,
    spec: TextSpec,
    options: MeasureOptions
  ) throws -> TextMeasurement {
    return layoutMeasurement(text: text, spec: spec, options: options)
  }

  func measureBatch(
    texts: [String],
    spec: TextSpec,
    options: MeasureOptions
  ) throws -> [TextMeasurement] {
    // Identical across the batch, so resolve once.
    let attributes = self.attributes(for: spec)
    return texts.map { text in
      measurement(
        for: transformed(text, spec: spec),
        attributes: attributes,
        options: options
      )
    }
  }

  func getFontMetrics(spec: TextSpec) throws -> FontMetrics {
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
    fontCache.removeAll()
  }

  // MARK: - Measurement

  private func layoutMeasurement(
    text: String,
    spec: TextSpec,
    options: MeasureOptions
  ) -> TextMeasurement {
    return measurement(
      for: transformed(text, spec: spec),
      attributes: attributes(for: spec),
      options: options
    )
  }

  private func measurement(
    for text: String,
    attributes: [NSAttributedString.Key: Any],
    options: MeasureOptions
  ) -> TextMeasurement {
    let maxLines = Int(options.maxLines ?? 0)
    let storage = NSTextStorage(string: text, attributes: attributes)
    let container = NSTextContainer(
      size: CGSize(width: options.maxWidth, height: .greatestFiniteMagnitude)
    )
    // RN renders with no inset; leaving TextKit's default 5pt padding here
    // would make every measurement 10pt narrower than the real thing.
    container.lineFragmentPadding = 0
    container.lineBreakMode = maxLines > 0 ? .byTruncatingTail : .byWordWrapping
    container.maximumNumberOfLines = maxLines

    let manager = NSLayoutManager()
    manager.usesFontLeading = false
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)

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

    return TextMeasurement(
      width: Double(widest),
      height: Double(used.height),
      lineCount: Double(lineCount),
      lastLineWidth: Double(lastLineWidth),
      didTruncate: didTruncate
    )
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
