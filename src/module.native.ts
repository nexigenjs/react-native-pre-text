import { NitroModules } from 'react-native-nitro-modules';

import type { PreText } from './PreText.nitro';

/** One hybrid object for the whole app — it owns the native font cache. */
let instance: PreText | null = null;

export function getModule(): PreText {
  if (instance === null) {
    instance = NitroModules.createHybridObject<PreText>('PreText');
  }
  return instance;
}
