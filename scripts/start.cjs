const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const distEntry = path.join(__dirname, '..', 'dist', 'index.js');
const srcEntry = path.join(__dirname, '..', 'src', 'index.ts');

if (fs.existsSync(distEntry)) {
  const child = spawn(process.execPath, [distEntry], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const child = spawn(process.execPath, ['--import', 'tsx', srcEntry], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
