import { Platform } from 'react-native';

export type FontOption = {
  id: string;
  label: string;
  group: string;
  fontFamily: string;
};

/**
 * One platform default plus four bundled OFL-licensed families from distinct
 * type groups. The bundled filenames match the family requested on Android;
 * iOS resolves the same family names from UIAppFonts.
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
    fontFamily: 'Fira Code',
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    group: 'multilingual sans',
    fontFamily: 'Noto Sans',
  },
];
