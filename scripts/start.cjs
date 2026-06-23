const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const distEntry = path.join(__dirname, '..', 'dist', 'src', 'index.js');
const srcEntry = path.join(__dirname, '..', 'src', 'index.ts');
const isProduction = process.env.NODE_ENV === 'production';

if (fs.existsSync(distEntry)) {
  const child = spawn(process.execPath, [distEntry], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  if (isProduction) {
    console.error(`❌ Compiled entrypoint not found: ${distEntry}`);
    console.error('Run the build step before starting the MobelTech API in production.');
    process.exit(1);
  }

  const child = spawn(process.execPath, ['--import', 'tsx', srcEntry], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
