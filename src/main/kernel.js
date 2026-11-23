// Translates a profile into kernel command-line arguments.
// Flag reference: https://github.com/adryfish/fingerprint-chromium (README, Chrome 144+).
const fs = require('fs');
const path = require('path');

const SPOOFING_KEYS = ['font', 'audio', 'canvas', 'clientrects', 'gpu'];

// Accept either a binary or a macOS .app bundle.
function resolveExecutable(kernelPath) {
  if (!kernelPath) throw new Error('Kernel path is not set. Configure it in Settings.');
  let exe = kernelPath;
  if (kernelPath.endsWith('.app')) {
    const macosDir = path.join(kernelPath, 'Contents', 'MacOS');
    const entries = fs.existsSync(macosDir) ? fs.readdirSync(macosDir) : [];
    if (entries.length === 0) throw new Error(`No executable inside ${macosDir}`);
    const preferred = entries.find((e) => /chrom/i.test(e)) || entries[0];
    exe = path.join(macosDir, preferred);
  }
  if (!fs.existsSync(exe)) throw new Error(`Kernel executable not found: ${exe}`);
  return exe;
}

/**
 * @param {object} profile
 * @param {object} ctx
 * @param {'fingerprint-chromium'|'chrome'} ctx.kernelType
 * @param {string} ctx.userDataDir
 * @param {number} ctx.debugPort
 * @param {string|null} ctx.proxyUrl   local, unauthenticated proxy URL
 * @param {string|null} ctx.timezone   resolved IANA timezone
 * @param {string|null} ctx.language   resolved language, e.g. en-US
 */
function buildArgs(profile, ctx) {
  const fp = profile.fingerprint || {};
  const args = [
    `--user-data-dir=${ctx.userDataDir}`,
    `--remote-debugging-port=${ctx.debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
  ];

  if (ctx.proxyUrl) args.push(`--proxy-server=${ctx.proxyUrl}`);
  if (ctx.language) {
    const primary = ctx.language.split('-')[0];
    const accept = primary === ctx.language ? ctx.language : `${ctx.language},${primary}`;
    args.push(`--lang=${ctx.language}`, `--accept-lang=${accept}`);
  }

  if (ctx.kernelType === 'fingerprint-chromium') {
    args.push(`--fingerprint=${fp.seed}`);
    if (fp.platform) args.push(`--fingerprint-platform=${fp.platform}`);
    if (fp.platformVersion) args.push(`--fingerprint-platform-version=${fp.platformVersion}`);
    if (fp.brand) args.push(`--fingerprint-brand=${fp.brand}`);
    if (fp.brandVersion) args.push(`--fingerprint-brand-version=${fp.brandVersion}`);
    if (fp.hardwareConcurrency) {
      args.push(`--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`);
    }
    if (ctx.timezone) args.push(`--timezone=${ctx.timezone}`);
    const disabled = (fp.disableSpoofing || []).filter((k) => SPOOFING_KEYS.includes(k));
    if (disabled.length) args.push(`--disable-spoofing=${disabled.join(',')}`);
    // The kernel already blocks non-proxied UDP for WebRTC by default.
  } else {
    // Plain Chrome/Chromium: profile isolation + proxy only, no fingerprint spoofing.
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }

  for (const a of profile.extraArgs || []) {
    if (typeof a === 'string' && a.trim()) args.push(a.trim());
  }
  const urls = (profile.startUrls || []).filter(Boolean);
  args.push(...(urls.length ? urls : ['about:blank']));
  return args;
}

// Plain Chrome has no --timezone flag; the TZ env var works on macOS/Linux.
function buildEnv(ctx) {
  const env = { ...process.env };
  if (ctx.kernelType !== 'fingerprint-chromium' && ctx.timezone) env.TZ = ctx.timezone;
  return env;
}

module.exports = { resolveExecutable, buildArgs, buildEnv, SPOOFING_KEYS };
