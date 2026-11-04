import {createRequire} from 'node:module';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
const require=createRequire(import.meta.url),ts=require(process.env.AIA_TYPESCRIPT_PATH);
const root=resolve(process.argv[2]??'/app');let checked=0;const missing=[];
function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
 const file=resolve(dir,entry.name);
 if(entry.isDirectory()){if(!['node_modules','.next','generated','dist'].includes(entry.name))visit(file);continue;}
 if(!/\.(ts|tsx|mjs)$/.test(file)||file.endsWith('/next-env.d.ts'))continue;
 const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 for(const node of tree.statements){
  if(!(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))||!node.moduleSpecifier||!ts.isStringLiteral(node.moduleSpecifier)||!node.moduleSpecifier.text.startsWith('.'))continue;
  const target=resolve(dirname(file),node.moduleSpecifier.text);
  if(!/\.(ts|tsx|mjs|json)$/.test(target)||target.includes('/node_modules/')||target.includes('/packages/database/src/generated/'))continue;
  checked++;if(!existsSync(target))missing.push(relative(root,file)+':'+node.moduleSpecifier.text);
 }
}}
for(const part of ['apps','packages','scripts','tests'])visit(resolve(root,part));
if(missing.length){console.error('SOURCE_RELATIVE_IMPORT_TARGETS_MISSING='+JSON.stringify(missing));process.exitCode=1;}
else console.log('SOURCE_RELATIVE_IMPORT_TARGETS_PASSED='+checked);
