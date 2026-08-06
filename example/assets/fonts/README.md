# Example fonts

The example bundles four well-known, freely redistributable typefaces from
Google Fonts. Each is licensed under the SIL Open Font License 1.1; the exact
license shipped by its upstream project is kept beside the font file.

| Local file | Family | Type | Upstream |
| --- | --- | --- | --- |
| `Inter.ttf` | Inter | neo-grotesque sans | <https://github.com/google/fonts/tree/main/ofl/inter> |
| `Lora.ttf` | Lora | contemporary serif | <https://github.com/google/fonts/tree/main/ofl/lora> |
| `FiraCode.ttf` | Fira Code | monospace | <https://github.com/google/fonts/tree/main/ofl/firacode> |
| `NotoSans.ttf` | Noto Sans | multilingual sans | <https://github.com/google/fonts/tree/main/ofl/notosans> |

These are the upstream variable TTF files, renamed to stable asset filenames so
React Native resolves the same names on Android and iOS. The files are bundled
only by the example application; they are not part of the published library.
