import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const outdir = './dist';

// Read version from package.json to inject at build time
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir,
  target: 'node',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
  define: {
    '__PKG_VERSION__': JSON.stringify(pkg.version),
  },
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Prepend shebang to the output file
const outFile = join(outdir, 'index.js');
const content = readFileSync(outFile, 'utf-8');
writeFileSync(outFile, `#!/usr/bin/env node\n${content}`);
chmodSync(outFile, 0o755);

console.log(`Build complete: ${outFile}`);
