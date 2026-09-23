#!/usr/bin/env node
/* ============================================================================
   StreamVault — tests/audit-keys.mjs
   i18n key audit. Run:  node tests/audit-keys.mjs
   Verifies:
     1. every static key used in code (t('…') / data-i18n / data-i18n-ph)
        exists in the EN pack
     2. every CORE key exists in ALL 19 language packs (long-form copy may
        fall back to English per the coverage contract in js/i18n.js)
     3. LONG_FORM keys exist in en + id
   Prints ALL STATIC KEYS PRESENT when green.
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// minimal browser shims so the module can be imported under Node
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { dispatchEvent: () => {} };
globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } };
globalThis.document = { documentElement: { lang: '', dir: '' }, querySelectorAll: () => [] };

const i18n = await import(join(root, 'js/i18n.js'));
const { CORE_KEYS, LANGS, LONG_FORM } = i18n;
const DICT = i18n.DICT;

// ---- collect static keys from source ---------------------------------------
const used = new Set();
const patterns = [
  /\bt\(\s*'([^']+)'\s*\)/g,
  /\bt\(\s*"([^"]+)"\s*\)/g,
  /data-i18n="([^"]+)"/g,
  /data-i18n-ph="([^"]+)"/g,
];

const jsFiles = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'js', f));
const htmlFiles = ['index.html', 'watch.html'].map((f) => join(root, f));

for (const file of [...jsFiles, ...htmlFiles]) {
  const src = readFileSync(file, 'utf8');
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) used.add(m[1]);
  }
}

let fail = 0;

// 1. every used key exists in EN
const missingEn = [...used].filter((k) => typeof DICT.en[k] !== 'string');
if (missingEn.length) {
  fail++;
  console.error(`✗ missing in EN pack (${missingEn.length}):`, missingEn.join(', '));
}

// 2. CORE coverage per pack
for (const lang of LANGS) {
  const pack = DICT[lang.code] || {};
  const missing = CORE_KEYS.filter((k) => typeof pack[k] !== 'string' || !pack[k].length);
  if (missing.length) {
    fail++;
    console.error(`✗ pack ${lang.code} missing ${missing.length} core keys:`, missing.slice(0, 12).join(', '), missing.length > 12 ? '…' : '');
  }
}

// 3. LONG_FORM present in en + id
for (const lang of ['en', 'id']) {
  const missing = [...LONG_FORM].filter((k) => typeof (DICT[lang] || {})[k] !== 'string');
  if (missing.length) {
    fail++;
    console.error(`✗ ${lang} missing long-form keys:`, missing.join(', '));
  }
}

console.log(`static keys used: ${used.size} · core keys per pack: ${CORE_KEYS.length} · packs: ${LANGS.length}`);
if (fail) {
  console.error('KEY AUDIT FAILED');
  process.exit(1);
}
console.log('ALL STATIC KEYS PRESENT');
