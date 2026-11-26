import { Platform } from 'react-native';

export type FontOption = {
  id: string;
  label: string;
  group: string;
  fontFamily: string;
};

/**
 * One platform default plus four bundled OFL-licensed families from distinct
 * type groups. On Android the family requested must be the asset's file name;
 * iOS resolves the font's own family name from UIAppFonts.
 */
export const FONT_OPTIONS: readonly FontOption[] = [
  {
    id: 'system',
    label: 'System',
    group: 'platform default',
    fontFamily: Platform.select({
      ios: 'System',
      android: 'sans-serif',
      default: 'System',
    }),
  },
  {
    id: 'inter',
    label: 'Inter',
    group: 'neo-grotesque sans',
    fontFamily: 'Inter',
  },
  {
    id: 'lora',
    label: 'Lora',
    group: 'contemporary serif',
    fontFamily: 'Lora',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    group: 'monospace',
    // Android finds an asset font by file name, and the file is FiraCode.ttf.
    // Asking for 'Fira Code' there silently falls back to the system font.
    fontFamily: Platform.select({ android: 'FiraCode', default: 'Fira Code' }),
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    group: 'multilingual sans',
    fontFamily: Platform.select({ android: 'NotoSans', default: 'Noto Sans' }),
  },
];
