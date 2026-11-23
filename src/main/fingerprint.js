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
  };
}

module.exports = { generateFingerprint, randomSeed, hostPlatform, PLATFORMS, PLATFORM_VERSIONS };
