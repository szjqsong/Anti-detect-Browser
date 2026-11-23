// JSON file store for profiles and settings.
// Writes are atomic (temp file + rename) so a crash never leaves a half-written db.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateFingerprint } = require('./fingerprint');

const DEFAULT_SETTINGS = {
  kernelType: 'fingerprint-chromium', // 'fingerprint-chromium' | 'chrome'
  kernelPath: '',
  apiPort: 54345,
  apiKey: '',
  defaultSearch: 'google', // 'google' | 'kernel' (kernel default: "No Search" on ungoogled-chromium)
  language: '', // '' = follow system; 'zh-TW' | 'zh-CN' | 'en'
};

class Store {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.file = path.join(baseDir, 'db.json');
    this.profilesDir = path.join(baseDir, 'profiles');
    fs.mkdirSync(this.profilesDir, { recursive: true });
    this.data = this._load();
    if (!this.data.settings.apiKey) {
      this.data.settings.apiKey = crypto.randomBytes(16).toString('hex');
      this._save();
    }
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep the unreadable file around instead of silently overwriting it.
        fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      }
      return { profiles: [], settings: { ...DEFAULT_SETTINGS } };
    }
  }

  _save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  userDataDir(id) {
    return path.join(this.profilesDir, id);
  }

  listProfiles() {
    return this.data.profiles;
  }

  getProfile(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  createProfile(input = {}) {
    const now = new Date().toISOString();
    const profile = {
      id: crypto.randomUUID(),
      name: input.name || `Profile ${this.data.profiles.length + 1}`,
      group: input.group || '',
      notes: input.notes || '',
      proxy: input.proxy || '',
      startUrls: input.startUrls || [],
      extraArgs: input.extraArgs || [],
      fingerprint: { ...generateFingerprint(input.fingerprint?.platform), ...(input.fingerprint || {}) },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    };
    this.data.profiles.push(profile);
    this._save();
    return profile;
  }

  updateProfile(id, patch) {
    const profile = this.getProfile(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    const { id: _ignored, createdAt: _c, ...rest } = patch;
    Object.assign(profile, rest, {
      fingerprint: { ...profile.fingerprint, ...(patch.fingerprint || {}) },
      updatedAt: new Date().toISOString(),
    });
    this._save();
    return profile;
  }

  deleteProfile(id) {
    const before = this.data.profiles.length;
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    if (this.data.profiles.length === before) return false;
    this._save();
    fs.rmSync(this.userDataDir(id), { recursive: true, force: true });
    return true;
  }

  getSettings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this._save();
    return this.data.settings;
  }
}

module.exports = { Store };
