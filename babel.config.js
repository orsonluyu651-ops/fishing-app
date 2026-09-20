// Standard Expo SDK 51 preset. Required for web support: babel-preset-expo
// rewrites `react-native` imports to react-native-web and applies the
// expo-router plugin. Without this file the web bundle falls back to real
// react-native internals and fails on react-native/Libraries/Renderer/...
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};