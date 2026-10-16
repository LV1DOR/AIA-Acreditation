import {build} from '../../apps/worker/node_modules/esbuild/lib/main.js';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('deployment',{recursive:true});
await build({entryPoints:['infra/production/entrypoint.ts'],outfile:'deployment/entrypoint.mjs',bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'info'});
await copyFile('infra/production/healthcheck.mjs','deployment/healthcheck.mjs');
