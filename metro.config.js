const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Why this hook exists
// -----------------------------
// 1. Expo's default Metro serializer force-preloads the REAL react-native
//    `Libraries/Core/InitializeCore` for every platform (web included).
//    On web, that module's dev/upgrade chain statically requires the native
//    Fabric renderer (`Libraries/Renderer/shims/ReactFabric` ->
//    `Libraries/ReactPrivate/ReactNativePrivateInterface` ->
//    `require('../Utilities/Platform')`). Real react-native 0.74 ships
//    Platform only as Platform.ios.js / Platform.android.js / Platform.flow.js —
//    there is no plain `Platform.js` and no `Platform.web.js` — so the web
//    bundle dies with "Unable to resolve module ../Utilities/Platform".
//    Nothing in a web build legitimately needs the Fabric renderer or the
//    ReactPrivate bridge, so for web we resolve any module under the real
//    react-native `Libraries/Renderer` or `Libraries/ReactPrivate` trees to
//    an empty module.
//
// 2. Some third-party node_modules (e.g. expo-modules-core, pulled in by
//    expo-image-picker) import the bare `react-native` package directly.
//    babel-preset-expo aliases `react-native` -> `react-native-web` for the
//    APP's own code, but it does not rewrite node_modules, so Metro resolves
//    those imports to the REAL react-native on web. Real react-native 0.74
//    also ships `Image` only as Image.ios.js / Image.android.js (no plain
//    Image.js), so the same class of crash fires again
//    ("Unable to resolve module ./Libraries/Image/Image"). We therefore
//    alias the bare package name to react-native-web at the resolver level,
//    which covers node_modules too.
//
// Native bundles (ios/android) are untouched: everything below only fires
// for platform === 'web'.

const realRnDir = path.join(__dirname, 'node_modules', 'react-native');

// Resolve the react-native-web entry file relative to this project.
function reactNativeWebEntry() {
  const webPkg = require.resolve('react-native-web/package.json', {
    paths: [__dirname],
  });
  const main = require(webPkg).main || 'index.js';
  return path.join(path.dirname(webPkg), main);
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    // (2) bare `react-native` from ANY source -> react-native-web.
    if (moduleName === 'react-native') {
      return { type: 'sourceFile', filePath: reactNativeWebEntry() };
    }

    // (1) Real react-native internals the web never legitimately needs.
    const origin = context.originModulePath || '';
    if (origin.startsWith(realRnDir + path.sep)) {
      let resolved = moduleName;
      if (!path.isAbsolute(resolved)) {
        resolved = path.normalize(path.join(path.dirname(origin), resolved));
      }
      const isFabricOrPrivate =
        resolved.startsWith(path.join(realRnDir, 'Libraries', 'Renderer') + path.sep) ||
        resolved.startsWith(path.join(realRnDir, 'Libraries', 'ReactPrivate') + path.sep);
      if (isFabricOrPrivate) {
        return { type: 'sourceFile', filePath: config.resolver.emptyModulePath };
      }
    }
  }
  // Fall through to Metro's own default resolver (this is what makes the
  // native bundles and everything else resolve exactly as before).
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;