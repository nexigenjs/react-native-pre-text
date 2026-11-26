import type { TextProps, TextStyle } from 'react-native';
import type { FontScaling } from '@nexigen/react-native-pre-text';

/**
 * One way a `<Text>` can respond to the system text size, expressed twice:
 * as the props the rendered `<Text>` gets and as the config `measure()` gets.
 * The two must say the same thing, which is the whole claim being tested.
 */
export type ScalingMode = {
  id: string;
  label: string;
  textProps: Pick<TextProps, 'allowFontScaling' | 'maxFontSizeMultiplier'>;
  config: FontScaling;
  /** Extra style for the rendered `<Text>` only; see the capped mode. */
  renderStyle?: TextStyle;
};

/** Below the smallest scale the checks run at, so the cap actually bites. */
const CAP = 1.2;

export const SCALING_MODES: readonly ScalingMode[] = [
  { id: 'system', label: 'system scale', textProps: {}, config: {} },
  {
    id: 'off',
    label: 'allowFontScaling false',
    textProps: { allowFontScaling: false },
    config: { allowFontScaling: false },
  },
  {
    id: 'capped',
    label: `maxFontSizeMultiplier ${CAP}`,
    textProps: { maxFontSizeMultiplier: CAP },
    config: { maxFontSizeMultiplier: CAP },
    // Before RN 0.87 its own measure cache (`areTextAttributesEquivalent-
    // LayoutWise` in TextMeasureCache.h) leaves `maxFontSizeMultiplier` out of
    // its key, so this mode would be handed the sizes the system mode just
    // measured for the same strings. Alignment is in the key and cannot move a
    // break or change a size in left-to-right text, so it keeps them apart.
    renderStyle: { textAlign: 'left' },
  },
];

export const SYSTEM_SCALING = SCALING_MODES[0]!;
