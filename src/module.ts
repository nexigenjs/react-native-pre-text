/** Web has no native backend and is out of scope — iOS and Android only. */
import type { PreText } from './PreText.nitro';

export function getModule(): PreText {
  throw new Error(
    "'@nexigen/react-native-pre-text' is only supported on iOS and Android.",
  );
}
