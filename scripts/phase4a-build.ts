import {config} from 'dotenv';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {releaseMaterials} from './lib/release-materials.ts';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
config({quiet:true});const dir='.impeccable/review/phase4a';await mkdir(dir,{recursive:true});
const admin=resolve(dir,'storage-admin');await mkdir(admin,{recursive:true});
// The administration utility is built in a bounded ordinary Docker container:
// Docker Desktop's BuildKit Go stage produced an empty output here. No prebuilt
// third-party replacement binary or credentials enter this named build context.
const goImage='golang:1.26-bookworm@sha256:d9c68c2c51161e12fd77e4c6320687c9cd86e1af1e3ad6e6cd63ff970641453c',module='github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z';
let utilityReady=false;try{const receipt=JSON.parse(await readFile(admin+'/receipt.json','utf8'));utilityReady=receipt.goImage===goImage&&receipt.module===module&&receipt.sha256===createHash('sha256').update(await readFile(admin+'/mc')).digest('hex');}catch{/* Missing or stale public utility artifacts are rebuilt below. */}
if(!utilityReady){const p=spawnSync('docker',['run','--rm','--cpus','2','--memory','1536m','--mount',`type=bind,source=${admin},target=/out`,'-e','GOBIN=/out','-e','GOMAXPROCS=2','-e','CGO_ENABLED=0',goImage,'go','install',module],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});await writeFile(dir+'/storage-admin-build.log',(p.stdout??'')+(p.stderr??''));if(p.status!==0)throw Error('STORAGE_ADMIN_SOURCE_BUILD_FAILED');await writeFile(admin+'/receipt.json',JSON.stringify({goImage,module,sha256:createHash('sha256').update(await readFile(admin+'/mc')).digest('hex')}));}
const materials=await releaseMaterials();await writeFile(dir+'/materials.json',JSON.stringify(materials,null,2));
const env={...process.env,AIA_SOURCE_SHA:materials.sourceSha};
for(const role of ['web','worker','tools']) {
 const args=['build','--file','infra/production/Dockerfile','--target',role,'--build-context','storage-admin='+admin,'--build-arg','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','--build-arg','AIA_SOURCE_SHA','--label','org.opencontainers.image.revision='+materials.sourceSha,'--tag','aia-accreditation-phase4a/'+role+':'+materials.sourceSha.slice(0,12),'.'];
 const r=spawnSync('docker',args,{env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});await writeFile(`${dir}/build-${role}.log`,(r.stdout??'')+(r.stderr??''));
 if(r.status!==0)throw Error('LINUX_CANDIDATE_BUILD_FAILED_'+role.toUpperCase());console.log('PASS Linux '+role+' candidate '+materials.sourceSha.slice(0,12));
}
const images:Record<string,unknown>={};for(const role of ['web','worker','tools']){const tag='aia-accreditation-phase4a/'+role+':'+materials.sourceSha.slice(0,12),r=spawnSync('docker',['image','inspect',tag],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('BUILT_IMAGE_INSPECTION_FAILED');const image=JSON.parse(r.stdout)[0];images[role]={tag,id:image.Id,user:image.Config.User,sizeBytes:image.Size,sourceLabel:image.Config.Labels?.['org.opencontainers.image.revision']};}
await writeFile(dir+'/images.json',JSON.stringify({sourceSha:materials.sourceSha,images,provider:'development-public-key-build',productionLaunchAuthorised:false},null,2));
