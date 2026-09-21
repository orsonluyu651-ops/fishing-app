// Jest configuration for the fishing-app unit baseline.
//
// tsconfig.json already excludes this file from type-checking (see
// "exclude": [..., "jest.config.js"]) — that exclusion was left behind by the
// interrupted scaffolding session, so this file restores the intended setup.
//
// preset "jest-expo" maps react-native/expo imports to Node-safe stand-ins so
// pure-logic modules (src/lib/*) test without a simulator. Component tests
// would additionally want a DOM environment — out of scope for this baseline.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/src/**/__tests__/**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // npm hoists expo-modules-core under expo's own node_modules rather than
  // the repo root, which jest-expo's preset setup cannot see on its own.
  // modulePaths behaves like NODE_PATH: searched after root node_modules, so
  // nothing at the root can be shadowed by expo's nested copies.
  modulePaths: ['<rootDir>/node_modules/expo/node_modules'],
};
