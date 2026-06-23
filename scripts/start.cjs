const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const srcEntry = path.join(__dirname, '..', 'src', 'index.ts');

if (!fs.existsSync(srcEntry)) {
  console.error(`❌ Source entrypoint not found: ${srcEntry}`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', srcEntry], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
