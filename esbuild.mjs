import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', target: 'node18', format: 'cjs', sourcemap: true };
await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] });
await build({ ...common, entryPoints: ['src/mcp/main.ts'], outfile: 'dist/mcp.js', banner: { js: '#!/usr/bin/env node' } });
