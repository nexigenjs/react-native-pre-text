---
layout: home
title: Measure React Native text before it renders

hero:
  name: react-native-pre-text
  text: Know what a &lt;Text&gt; will render as, before it renders
  tagline: Exact heights for chat lists and feeds that don't jump on a fast scroll, scrollToIndex that lands, and "Read more" without rendering twice. Measured by the same engine that draws the text.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why chat lists jump
      link: /guide/why
    - theme: alt
      text: GitHub
      link: https://github.com/nexigenjs/react-native-pre-text

features:
  - title: The renderer, answering early
    details: iOS TextKit and Android StaticLayout, the engines &lt;Text&gt; uses, measure the text. Line breaking, kinsoku, bidi, Thai and emoji come out as they are drawn, because they are drawn by the same code.
  - title: Chat lists that don't jump
    details: Give FlatList's getItemLayout the real heights and it stops guessing row sizes, the guess that makes a fast fling teleport the list.
  - title: Checked against onLayout
    details: The example checks every measurement against the rendered &lt;Text&gt;, by itself, at launch. 65 real-world strings, 5 fonts, three system text sizes, iOS and Android.
  - title: System text size, done like &lt;Text&gt;
    details: Dynamic Type and Android's nonlinear font scaling apply exactly as React Native applies them, allowFontScaling and maxFontSizeMultiplier included.
  - title: Synchronous and cached
    details: One call, no await, nothing rendered. measureBatch sizes a whole list in a single crossing to native.
  - title: New Architecture and Expo
    details: React Native 0.85 and later over Nitro Modules. Works in Expo development builds.
---
