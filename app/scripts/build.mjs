import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist'));
for (const file of ['index.html', 'policy.html', 'map-fallback.js']) {
  await cp(join(root, 'src', file), join(root, 'dist', file));
}
await cp(join(root, 'src', 'vendor'), join(root, 'dist', 'vendor'), { recursive: true });
await build({ entryPoints: [join(root, 'src', 'native.js')], outfile: join(root, 'dist', 'native.js'), bundle: true, minify: true, platform: 'browser', format: 'iife' });
