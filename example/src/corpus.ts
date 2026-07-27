/**
 * The test corpus: one entry per distinct way text layout can go wrong.
 *
 * This is a suite, not a data set — there is no padding to a round number,
 * because a thousand copies of the same cases test nothing the cases do not.
 *
 * The weight is deliberately on Latin, because that is what the app ships to.
 * These are meant to read like real US-English product content — chat
 * messages, prices, addresses, reviews, handles, pasted links — rather than
 * lorem ipsum, since the things that actually break layout are the things
 * real text is full of: doubled spaces after a period, curly quotes, em
 * dashes, non-breaking spaces from a paste, a trademark sign, an emoji at the
 * end of a sentence.
 *
 * The non-Latin block is smaller and exists as regression cover. A few entries
 * there are pure isolation probes: `thai-plain` carries no stacked marks and
 * `thai-heavy-marks` carries as many as possible, so together they answer
 * whether Thai mispredicts because it is Thai or because of the marks —
 * `vietnamese` asks the same question in Latin script.
 */

export type Sample = {
  /** Unique and human-readable — also used as the React key. */
  id: string;
  kind: string;
  text: string;
};

/** U+00A0 — arrives constantly via copy-paste and does not break lines. */
const NBSP = ' ';

export const SAMPLES: Sample[] = [
  // --- Everyday US-English content -----------------------------------------
  {
    id: 'chat-short',
    kind: 'chat-short',
    text: 'Hey, are we still on for 6?',
  },
  {
    id: 'chat-long',
    kind: 'chat-long',
    text:
      "Just got out of the gym and honestly that was the hardest session I've " +
      'done all month. Coach kept adding rounds every time someone complained, ' +
      "so nobody said a word for the last twenty minutes. Worth it though.",
  },
  {
    id: 'double-space-sentences',
    kind: 'double-space-sentences',
    text:
      'This is the first sentence.  This is the second one.  Two spaces after ' +
      'every period, the way half of America still types.',
  },
  {
    id: 'ragged-spacing',
    kind: 'ragged-spacing',
    text: 'sent    from   my    phone     sorry   about      the   spacing',
  },
  {
    id: 'leading-trailing-space',
    kind: 'leading-trailing-space',
    text: '   padded on both ends   ',
  },
  {
    id: 'space-before-punctuation',
    kind: 'space-before-punctuation',
    text: 'Wait , really ? That seems off ... let me check !',
  },
  {
    id: 'nbsp-from-paste',
    kind: 'nbsp-from-paste',
    text: `Pasted${NBSP}from${NBSP}a${NBSP}webpage — these are non-breaking spaces and they refuse to wrap.`,
  },
  {
    id: 'tabs',
    kind: 'tabs',
    text: 'Name\tQty\tPrice\nWidget\t2\t$19.99',
  },
  {
    id: 'multi-paragraph',
    kind: 'multi-paragraph',
    text: 'First paragraph of the note.\n\nSecond paragraph after a blank line.',
  },
  {
    id: 'newline-heavy',
    kind: 'newline-heavy',
    text: 'one\ntwo\nthree\nfour',
  },

  // --- Latin symbols, the main event ---------------------------------------
  {
    id: 'smart-quotes',
    kind: 'smart-quotes',
    text: '“Smart quotes” and ‘single ones’ versus "straight" and \'plain\' — they measure differently.',
  },
  {
    id: 'dashes-and-ellipsis',
    kind: 'dashes-and-ellipsis',
    text: 'Hyphen-thin, en–dash, em—dash, minus −, and an ellipsis… next to three dots ...',
  },
  {
    id: 'legal-marks',
    kind: 'legal-marks',
    text: 'Nexigen™ © 2026 Example, Inc.® — All rights reserved § 4 ¶ 2 † ‡',
  },
  {
    id: 'currency-and-prices',
    kind: 'currency-and-prices',
    text: 'Was $1,299.00, now $999 — save 23%. Also £849, €929, ¥149,800, and ₿0.0142.',
  },
  {
    id: 'units-and-fractions',
    kind: 'units-and-fractions',
    text: '72 °F · 5′11″ · ½ cup · ¼ tsp · 3 × 4 ÷ 2 ± 0.5 · 30 µs · №7 · ~250 kcal',
  },
  {
    id: 'stars-and-rating',
    kind: 'stars-and-rating',
    text: '★★★★☆ 4.2 (1,284 reviews) · ✓ Verified purchase · ⚡ Ships today',
  },
  {
    id: 'handles-and-tags',
    kind: 'handles-and-tags',
    text: '@sam_welles tagged you in #morningrun #5amclub — 3 others reacted 👍',
  },
  {
    id: 'url-in-sentence',
    kind: 'url-in-sentence',
    text: 'Signup is at https://example.com/very/long/path/segment/that/never/breaks?ref=abcdefghijklmnop so grab a spot.',
  },
  {
    id: 'email-and-phone',
    kind: 'email-and-phone',
    text: 'Reach us at support+billing@really-long-domain-name.example.com or (415) 555‑0142.',
  },
  {
    id: 'us-address',
    kind: 'us-address',
    text: '1600 Pennsylvania Ave NW\nWashington, DC 20500\nUnited States',
  },
  {
    id: 'abbreviations',
    kind: 'abbreviations',
    text: 'Dr. Reyes, Ph.D., of the U.S. Dept. of Ed. will speak at 9 a.m. (approx.) re: the Q3 P&L.',
  },
  {
    id: 'contractions-possessives',
    kind: 'contractions-possessives',
    text: "Don't forget it's O'Brien's turn — they've said they'll bring Sarah-Jane's gear.",
  },
  {
    id: 'all-caps',
    kind: 'all-caps',
    text: 'URGENT: YOUR SUBSCRIPTION RENEWS IN 24 HOURS — UPDATE PAYMENT NOW',
  },
  {
    id: 'code-inline',
    kind: 'code-inline',
    text: 'Run `npm run codegen && pod install` then check `ios/build/` for the .app bundle.',
  },
  {
    id: 'markdown-ish',
    kind: 'markdown-ish',
    text: '**Bold**, _italic_, ~~struck~~, [a link](https://example.com), and `code` all inline.',
  },
  {
    id: 'bullet-list',
    kind: 'bullet-list',
    text: '• Warm up 10 min\n• 5 × 400m intervals\n• Cool down 10 min',
  },
  {
    id: 'brackets-and-operators',
    kind: 'brackets-and-operators',
    text: 'if (a[0] && b["k"]) { c = {x: 1, y: 2}; } // <- braces, brackets, pipes | slashes \\ carets ^',
  },
  {
    id: 'identifiers',
    kind: 'identifiers',
    text: 'camelCaseName, snake_case_name, SCREAMING_SNAKE, kebab-case-name, PascalCaseName',
  },

  // --- Runs with few or no break opportunities ------------------------------
  {
    id: 'unbreakable-token',
    kind: 'unbreakable-token',
    text: 'aaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeeeffffffffffgggggggggg',
  },
  {
    id: 'hyphenated-chain',
    kind: 'hyphenated-chain',
    text: 'well-known-but-rather-long-hyphenated-compound-word-chain-goes-here',
  },
  {
    id: 'single-long-word',
    kind: 'single-long-word',
    text: 'Antidisestablishmentarianism',
  },

  // --- Emoji and grapheme clusters ------------------------------------------
  {
    id: 'emoji-trailing',
    kind: 'emoji-trailing',
    text: 'Nailed the PR today 💪🔥',
  },
  {
    id: 'emoji-inline',
    kind: 'emoji-inline',
    text: 'Coffee ☕ first, then a 🏃 5k, then 🧘 twenty minutes of nothing at all.',
  },
  {
    id: 'emoji-only',
    kind: 'emoji-only',
    text: '🎉🎉🎉',
  },
  {
    id: 'emoji-zwj',
    kind: 'emoji-zwj',
    text: '👨‍👩‍👧‍👦 👩‍💻 🧑‍🚒 👨‍👨‍👦‍👦 — ZWJ sequences that must stay one cluster',
  },
  {
    id: 'emoji-skin-tone',
    kind: 'emoji-skin-tone',
    text: '🧑🏽‍💻 👋🏿 💪🏻 🙆🏾‍♀️ 🤝🏼 — modifier bases',
  },
  {
    id: 'emoji-flags',
    kind: 'emoji-flags',
    text: '🇺🇸 🇺🇦 🇯🇵 🇬🇧 🇰🇷 🏴󠁧󠁢󠁳󠁣󠁴󠁿 — regional indicators',
  },
  {
    id: 'emoji-dense',
    kind: 'emoji-dense',
    text: '🎈🎊🧨🪅🎁🎀🪄🧿🔮🪬🎲🕹️🧸🪆🖼️🧵🪡🧶🪢🎈🎊🧨🪅🎁🎀🪄🧿🔮🪬🎲',
  },

  // --- Accented Latin, still the target market -------------------------------
  {
    id: 'accented-latin',
    kind: 'accented-latin',
    text: 'Café résumé naïve piñata jalapeño Zoë Ångström — common enough in US copy.',
  },
  {
    id: 'combining-marks',
    kind: 'combining-marks',
    text: 'precomposed éàöñů vs combining éàöñů — same letters, different code points',
  },
  {
    id: 'vietnamese',
    kind: 'vietnamese',
    text: 'Tiếng Việt có dấu thanh chồng lên nguyên âm, ví dụ như ườ ẫ ộ ỗ ẳ ẵ ữ.',
  },

  // --- Degenerate input -----------------------------------------------------
  {
    id: 'single-char',
    kind: 'single-char',
    text: 'W',
  },
  {
    id: 'only-space',
    kind: 'only-space',
    text: ' ',
  },
  {
    id: 'near-wrap-boundary',
    kind: 'near-wrap-boundary',
    text: 'This line is tuned to sit very close to the wrap boundary!!',
  },

  // --- Non-Latin regression cover -------------------------------------------
  {
    id: 'han-simplified',
    kind: 'han-simplified',
    text: '这是一段没有空格的中文文本，用来测试在没有明显断行机会时的换行行为和高度预测是否准确。',
  },
  {
    id: 'japanese',
    kind: 'japanese',
    text: '日本語のテキストです。ひらがな、カタカナ、漢字が混ざっていて、禁則処理（きんそくしょり）も必要になります。',
  },
  {
    id: 'korean',
    kind: 'korean',
    text: '한국어 텍스트입니다. 한글은 음절 단위로 조합되며 줄바꿈 규칙이 라틴 문자와 다릅니다.',
  },
  {
    id: 'thai-no-spaces',
    kind: 'thai-no-spaces',
    text: 'ข้อความภาษาไทยไม่มีช่องว่างระหว่างคำจึงต้องใช้การแบ่งคำแบบพจนานุกรมเพื่อขึ้นบรรทัดใหม่',
  },
  {
    id: 'thai-plain',
    kind: 'thai-plain',
    text: 'กขคงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮกขคงจฉชซ',
  },
  {
    id: 'thai-heavy-marks',
    kind: 'thai-heavy-marks',
    text: 'ที่นี่มีสิ่งที่น่าสนใจอยู่หลายอย่างซึ่งต้องใช้เครื่องหมายกำกับเสียงจำนวนมากที่สุด',
  },
  {
    id: 'arabic-rtl',
    kind: 'arabic-rtl',
    text: 'هذا نص عربي يُكتب من اليمين إلى اليسار ويحتوي على تشكيل وحروف متصلة لاختبار القياس.',
  },
  {
    id: 'hebrew-rtl',
    kind: 'hebrew-rtl',
    text: 'זהו טקסט בעברית הנכתב מימין לשמאל, עם ניקוד וסימני פיסוק.',
  },
  {
    id: 'bidi-mixed',
    kind: 'bidi-mixed',
    text: 'Mixed direction: العربية inside English, then back to latin.',
  },
  {
    id: 'devanagari',
    kind: 'devanagari',
    text: 'यह देवनागरी लिपि में लिखा गया पाठ है जिसमें संयुक्ताक्षर और मात्राएँ शामिल हैं।',
  },
  {
    id: 'cyrillic',
    kind: 'cyrillic',
    text: "Кириличний текст із українськими літерами ґ, є, і, ї та апострофом — з'єднання.",
  },
  {
    id: 'mixed-everything',
    kind: 'mixed-everything',
    text: 'Hello 世界 مرحبا שלום こんにちは 안녕하세요 Привіт 👋🏽 — 42%',
  },
];
