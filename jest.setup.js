// Shared Jest setup: basic mock coverage for the native modules the offline
// catch queue (and future tests) depend on. Runs before every test file.
//
//  - @react-native-async-storage/async-storage → in-memory Map store
//  - @react-native-community/netinfo → static connection listener/fetch
//  - expo-file-system → inert File/Directory/Paths stand-ins
//
// Supabase env vars get inert dummies so importing src/lib/supabase.ts
// directly does not throw on its missing-env guard. Tests that need to
// control network behaviour must jest.mock('../supabase') themselves — see
// src/lib/__tests__/offlineCatchQueue.test.ts.

process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'dummy-anon-key';

// ── AsyncStorage: backed by a Map so queue persistence is testable and the
// offlineCatchQueue storage path exercises the real getItem/setItem calls ──
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();

  const AsyncStorage = {
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => {
      store.set(key, String(value));
    }),
    removeItem: jest.fn(async (key) => {
      store.delete(key);
    }),
    clear: jest.fn(async () => {
      store.clear();
    }),
    getAllKeys: jest.fn(async () => Array.from(store.keys())),
    multiGet: jest.fn(async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null])),
    multiSet: jest.fn(async (pairs) => pairs.forEach(([k, v]) => store.set(k, String(v)))),
    multiRemove: jest.fn(async (keys) => keys.forEach((k) => store.delete(k))),
  };
  // Exposed (underscore-prefixed, not part of the AsyncStorage contract) so a
  // test can inspect raw contents without going through the async API.
  AsyncStorage.__store = store;

  return { __esModule: true, default: AsyncStorage };
});

// ── NetInfo: static "connected over wifi" with a subscribable listener, so
// future reconnect/sync-trigger tests can flip `__state.isConnected` ──
jest.mock('@react-native-community/netinfo', () => {
  const state = { isConnected: true, type: 'wifi', isInternetReachable: true };
  return {
    __esModule: true,
    default: {
      addEventListener: jest.fn(() => ({ unsubscribe: jest.fn() })),
      fetch: jest.fn(async () => ({ ...state })),
      getCurrentState: jest.fn(async () => ({ ...state })),
      useNetInfo: jest.fn(() => ({ ...state })),
      configure: jest.fn(),
      // Mutable test handle: flip isConnected to simulate offline.
      __state: state,
    },
  };
});

// ── expo-file-system: the new SDK File/Directory/Paths API is stand-in only.
// offlineCatchQueue imports it at module scope, so the mock must exist even
// for tests that never touch a photo. ──
jest.mock('expo-file-system', () => {
  const contents = new Map(); // uri → marker
  const legacyContents = new Map(); // uri → placeholder for legacy API

  class MockFileSystemNode {
    constructor(...args) {
      const parts = args.map((a) =>
        typeof a === 'string' ? a : a?.uri ?? String(a),
      ).filter((s) => typeof s === 'string' && s.length > 0);
      this.uri = parts.length > 0 ? parts.join('/') : String(args[0]);
      this.exists = contents.has(this.uri);
    }
    async bytes() {
      return new Uint8Array(0);
    }
    delete() {
      contents.delete(this.uri);
      this.exists = false;
    }
  }

  class MockFile extends MockFileSystemNode {
    copy(dest) {
      const target = typeof dest === 'string' ? dest : dest?.uri ?? String(dest);
      contents.set(target, 'copied');
    }
    write(content) {
      contents.set(this.uri, typeof content === 'string' ? content : 'binary');
      this.exists = true;
    }
    async text() {
      return contents.has(this.uri) ? String(contents.get(this.uri)) : '';
    }
  }

  class MockDirectory extends MockFileSystemNode {
    create() {
      contents.set(this.uri, 'directory');
      this.exists = true;
    }
    list() {
      const prefix = `${this.uri}/`;
      const out = [];
      for (const key of contents.keys()) {
        if (key.startsWith(prefix)) out.push(new MockFile(key));
      }
      return out;
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      document: '/mock/documents',
      cache: '/mock/cache',
      basename: (uri) => String(uri).split('/').pop() ?? '',
    },
    documentDirectory: '/mock/documents/',
    cacheDirectory: '/mock/cache/',
    writeAsStringAsync: jest.fn(async () => undefined),
    EncodingType: { UTF8: 'utf8' },
    getInfoAsync: jest.fn(async (uri) => ({
      exists: legacyContents.has(uri),
      size: legacyContents.has(uri) ? 1024 : 0,
    })),
    makeDirectoryAsync: jest.fn(async (uri, _options) => {
      legacyContents.set(uri, 'directory');
      return undefined;
    }),
    downloadAsync: jest.fn(async (sourceUrl, destUri) => {
      legacyContents.set(destUri, 'downloaded');
      return { uri: destUri };
    }),
  };
});

// ── expo-sharing: inert share dialog mock — always resolves successfully ──
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => true),
}));

// ── expo-print: inert PDF renderer mock — returns a deterministic file URI ──
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async () => ({ uri: 'file:///mock-print/export.pdf' })),
}));

// ── expo-local-authentication: inert biometric hardware mock ──
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1]),
  authenticateAsync: jest.fn(async () => ({ success: false, type: null })),
  AuthenticationType: { FACE_ID: 1, TOUCH_ID: 2, FINGERPRINT: 3, IRIS: 4, BIOOMETRIC: 5 },
}));
