import { defineConfig } from 'vitepress';

const SITE = 'https://nexigenjs.github.io/react-native-pre-text/';
const REPO = 'https://github.com/nexigenjs/react-native-pre-text';
const NPM = 'https://www.npmjs.com/package/@nexigen/react-native-pre-text';

const DESCRIPTION =
  'Measure React Native text before it renders, with the engine that draws it. ' +
  'Exact row heights for chat lists and feeds that do not jump on a fast scroll, ' +
  'scrollToIndex that lands, and "Read more" without rendering twice.';

export default defineConfig({
  lang: 'en-US',
  title: 'react-native-pre-text',
  titleTemplate: ':title · react-native-pre-text',
  description: DESCRIPTION,
  base: '/react-native-pre-text/',
  cleanUrls: true,
  sitemap: { hostname: SITE },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/react-native-pre-text/logo.svg' }],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'react native text measurement, measure text height before render, ' +
          'FlatList getItemLayout, chat list jumping, inverted FlatList, ' +
          'scrollToIndex, read more, numberOfLines, text height, react native chat',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'react-native-pre-text' }],
    ['meta', { property: 'og:description', content: DESCRIPTION }],
    ['meta', { property: 'og:url', content: SITE }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/why' },
      { text: 'API', link: '/api' },
      { text: 'npm', link: NPM },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Why chat lists jump', link: '/guide/why' },
          { text: 'Getting started', link: '/guide/getting-started' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Chat list with getItemLayout', link: '/guide/chat-list' },
          { text: 'Use cases', link: '/guide/use-cases' },
          { text: 'System text size', link: '/guide/text-size' },
          { text: 'Upgrading to 1.0', link: '/guide/upgrading' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API', link: '/api' },
          { text: 'How it stays accurate', link: '/guide/accuracy' },
          { text: 'Performance', link: '/guide/performance' },
          { text: 'Known limits', link: '/guide/known-limits' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
    },
  },
});
