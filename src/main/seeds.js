// Audio-aware seed selection.
// fingerprint-chromium 148 maps seeds onto only ~6-7 distinct Audio noise outputs, and
// ~17% of seeds add no audio noise at all (output == the machine's real fingerprint).
// We can't change that without rebuilding the kernel, but we can choose seeds that
//   1. are never "no-noise" seeds, and
//   2. land in the audio bucket used by the fewest existing profiles.
const { probe, audioBaseline } = require('./probe');
const { randomSeed } = require('./fingerprint');

// Values that depend on these fields; a stored probe is stale if any changed.
function probeSignature(fp, kernelId) {
  return [kernelId, fp.seed, fp.platform, fp.platformVersion, fp.brand, fp.brandVersion,
    fp.hardwareConcurrency, (fp.disableSpoofing || []).slice().sort().join('+')].join('|');
}

function audioUsage(profiles, kernelId, excludeId) {
  const used = new Map();
  for (const p of profiles) {
    if (p.id === excludeId) continue;
    const pr = p.fingerprint?.probe;
    if (!pr || pr.signature !== probeSignature(p.fingerprint, kernelId)) continue;
    used.set(pr.audioHash, (used.get(pr.audioHash) || 0) + 1);
  }
  return used;
}

async function describe(exe, kernelId, fp, profiles, excludeId) {
  const [r, baseline] = await Promise.all([probe(exe, fp), audioBaseline(exe)]);
  const shared = audioUsage(profiles, kernelId, excludeId).get(r.audioHash) || 0;
  return {
    ...r,
    audioNoNoise: r.audioHash === baseline,
    audioSharedWith: shared,
    signature: probeSignature(fp, kernelId),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Picks a seed for `fp` (other fields kept). Tries up to `maxTries` random seeds and
 * returns the best: never a no-noise seed, and preferably an unused audio bucket.
 */
async function pickSeed({ exe, kernelId, fp, profiles, excludeId, maxTries = 16, parallel = 4 }) {
  const baseline = await audioBaseline(exe);
  const used = audioUsage(profiles, kernelId, excludeId);
  let best = null;
  // Audio buckets are unevenly distributed (one takes ~1/3 of seeds, some ~2%), so
  // sample in parallel batches and stop as soon as an unused bucket turns up.
  for (let tried = 0; tried < maxTries && !(best && best.shared === 0); tried += parallel) {
    const batch = Array.from({ length: Math.min(parallel, maxTries - tried) }, () => ({ ...fp, seed: randomSeed() }));
    const results = await Promise.all(batch.map((c) => probe(exe, c).then((r) => ({ c, r })).catch(() => null)));
    for (const x of results) {
      if (!x || x.r.audioHash === baseline) continue;
      const shared = used.get(x.r.audioHash) || 0;
      if (!best || shared < best.shared) best = { fp: x.c, r: x.r, shared };
    }
  }
  if (!best) throw new Error('找不到有 Audio 雜訊的種子，請重試');
  return {
    seed: best.fp.seed,
    probe: {
      ...best.r,
      audioNoNoise: false,
      audioSharedWith: best.shared,
      signature: probeSignature(best.fp, kernelId),
      checkedAt: new Date().toISOString(),
    },
  };
}

module.exports = { pickSeed, describe, probeSignature };
