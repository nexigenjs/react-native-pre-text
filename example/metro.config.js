const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

/**
 * The library is linked from the parent directory, so Metro has to watch it
 * and be told where the single copy of react/react-native lives — otherwise a
 * symlinked package pulls in its own and you get two Reacts.
 */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
