// Lists translation keys: every t('...') in the renderer plus module-level strings
// translated at their use sites, and reports keys missing from each locale.
//   node scripts/i18n-keys.js [--missing]
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const root = path.join(__dirname, '..', 'src', 'renderer', 'src');
const CJK = /[㐀-鿿　-〿＀-￯]/;
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'locales') walk(p); }
    else if (/\.jsx?$/.test(f) && f !== 'i18n.js') files.push(p);
  }
})(root);

const keys = new Set();
for (const f of files) {
  const ast = parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    CallExpression(p) {
      const a = p.node.arguments[0];
      if (p.node.callee.name === 't' && a && a.type === 'StringLiteral') keys.add(a.value);
    },
    StringLiteral(p) {
      // module-level strings (translated where they are rendered)
      if (!p.getFunctionParent() && CJK.test(p.node.value) && !p.parentPath.isImportDeclaration()) keys.add(p.node.value);
    },
  });
}
// Messages thrown by the main process and shown in the UI.
for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'main'))) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', f), 'utf8');
  for (const m of src.matchAll(/new Error\('([^']*[㐀-鿿][^']*)'\)/g)) keys.add(m[1]);
}
const list = [...keys].sort();
if (process.argv.includes('--missing')) {
  let bad = 0;
  for (const loc of ['zh-CN', 'en']) {
    const file = path.join(root, 'locales', `${loc}.js`);
    const dict = fs.existsSync(file) ? (0, eval)(fs.readFileSync(file, 'utf8').replace(/^export default/m, '(').replace(/;\s*$/, '') + ')') : {};
    const missing = list.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !keys.has(k));
    console.log(`${loc}: ${list.length - missing.length}/${list.length} translated, ${missing.length} missing, ${extra.length} unused`);
    missing.forEach((k) => console.log('  MISSING', JSON.stringify(k)));
    bad += missing.length;
  }
  process.exit(bad ? 1 : 0);
} else {
  console.log(JSON.stringify(list, null, 0));
}
