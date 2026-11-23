// electron-builder afterPack hook: ad-hoc sign the app bundle.
// Without an Apple Developer ID the bundle would otherwise ship with a broken
// signature (Electron's upstream signature is invalidated by repackaging), and
// Apple Silicon refuses to run it ("app is damaged").
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  ${app}`);
};
