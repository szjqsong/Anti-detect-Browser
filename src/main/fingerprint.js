// Fingerprint generation.
// fingerprint-chromium derives canvas/webgl/audio/font/clientrects noise from a single
// seed, so we only pick the values that must stay consistent with each other
// (platform, OS version, brand, cores, language, timezone).
const crypto = require('crypto');

const PLATFORMS = ['windows', 'macos', 'linux'];

// UA-CH platformVersion values. Windows 10 reports 10.0.0, Windows 11 reports 13+.
const PLATFORM_VERSIONS = {
  windows: ['10.0.0', '15.0.0', '19.0.0'],
  macos: ['13.6.0', '14.6.1', '15.2.0'],
  linux: [''],
};

// Common screens per platform: [cssWidth, cssHeight, devicePixelRatio].
const SCREEN_PRESETS = {
  windows: [[1920, 1080, 1], [1920, 1080, 1], [1536, 864, 1.25], [1366, 768, 1], [2560, 1440, 1], [1440, 900, 1], [1280, 720, 1.5]],
  macos: [[1440, 900, 2], [1512, 982, 2], [1728, 1117, 2], [1470, 956, 2], [1920, 1080, 1], [2560, 1440, 1]],
  linux: [[1920, 1080, 1], [1366, 768, 1], [2560, 1440, 1], [1600, 900, 1]],
};

// Weighted toward common consumer hardware.
const CORE_CHOICES = [4, 4, 8, 8, 8, 12, 16];

const pick = (arr) => arr[crypto.randomInt(arr.length)];

function hostPlatform() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

function randomSeed() {
  // Positive 32-bit integer, as the kernel expects.
  return crypto.randomInt(1, 2 ** 31 - 1);
}

function generateFingerprint(platform) {
  const p = PLATFORMS.includes(platform) ? platform : hostPlatform();
  return {
    seed: randomSeed(),
    platform: p,
    platformVersion: pick(PLATFORM_VERSIONS[p]),
    brand: 'Chrome',
    brandVersion: '', // empty = kernel default, which matches the real kernel version
    hardwareConcurrency: pick(CORE_CHOICES),
    language: 'auto', // 'auto' = derive from proxy exit country
    timezone: 'auto', // 'auto' = derive from proxy exit IP
    disableSpoofing: [], // subset of: font, audio, canvas, clientrects, gpu
    // 'real' keeps the host screen; a different OS gets a plausible screen for that OS.
    screen: p === hostPlatform() ? { mode: 'real' } : randomScreen(p),
    // Coordinates are always overridden so the OS's real location is never exposed.
    geolocation: { permission: 'ask', source: 'auto', latitude: null, longitude: null, accuracy: 50 },
  };
}

function randomScreen(platform) {
  const [width, height, dpr] = pick(SCREEN_PRESETS[platform] || SCREEN_PRESETS.windows);
  return { mode: 'custom', width, height, dpr };
}

// Fills fields added after a profile was created.
function withDefaults(fp = {}) {
  return {
    ...fp,
    disableSpoofing: fp.disableSpoofing || [],
    screen: fp.screen || { mode: 'real' },
    geolocation: { permission: 'ask', source: 'auto', latitude: null, longitude: null, accuracy: 50, ...(fp.geolocation || {}) },
  };
}

module.exports = { generateFingerprint, randomSeed, hostPlatform, withDefaults, randomScreen, PLATFORMS, PLATFORM_VERSIONS, SCREEN_PRESETS };
