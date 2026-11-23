// Minimal i18n. Source strings (Traditional Chinese) are the keys; zh-CN and en
// dictionaries map them. Missing translations fall back to the key.
import zhCN from './locales/zh-CN.js';
import en from './locales/en.js';

export const LANGUAGES = [
  ['zh-TW', '繁體中文'],
  ['zh-CN', '简体中文'],
  ['en', 'English'],
];

const DICTS = { 'zh-TW': null, 'zh-CN': zhCN, en };
let current = 'zh-TW';

/** '' (follow system) -> concrete language from the OS locale. */
export function resolveLanguage(setting, systemLocale = '') {
  if (setting && setting in DICTS) return setting;
  const l = systemLocale.toLowerCase();
  if (l.startsWith('zh')) return /(tw|hk|mo|hant)/.test(l) ? 'zh-TW' : 'zh-CN';
  return 'en';
}

export function setLanguage(lang) {
  current = lang in DICTS ? lang : 'zh-TW';
  document.documentElement.lang = current === 'en' ? 'en' : current === 'zh-CN' ? 'zh-Hans' : 'zh-Hant';
}

export const getLanguage = () => current;

export function t(key, vars) {
  if (typeof key !== 'string') return key;
  const dict = DICTS[current];
  let s = (dict && dict[key]) ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
