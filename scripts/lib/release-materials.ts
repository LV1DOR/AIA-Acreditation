import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {relative,join} from 'node:path';
// Exact build inputs, including uncommitted implementation; no environment, secrets or generated output.
export async function releaseMaterials(root=process.cwd()) {
 const ignored=new Set(['node_modules','.git','.impeccable','deployment','dist','generated','test-results','playwright-report']);
 const files:string[]=[];
 async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){if(ignored.has(e.name)||e.name.startsWith('.next')||e.name.startsWith('.candidate-')||e.name.startsWith('.env')||/\.(log|tsbuildinfo)$/.test(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())files.push(p);}}
 for(const dir of ['apps','packages','infra','scripts','tests'])await walk(join(root,dir));
 for(const f of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.tests.json','vitest.config.ts','eslint.config.mjs','.dockerignore'])files.push(join(root,f));
 const entries=[];for(const f of files.sort())entries.push({path:relative(root,f).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(f)).digest('hex')});
 return {sourceSha:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),files:entries};
}
