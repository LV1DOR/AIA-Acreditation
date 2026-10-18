// Full staging test + unchanged app storage adapter, executed against an in-memory S3/CLI fixture.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const root='/home/luke/aia-accreditation-staging-kit';
async function scenario(failure){
 const objects=new Map(),commands=[],outputs=[];let bucketExists=false,report,sequence=0;
 const env={DEPLOYMENT_ENV:'staging',AIA_SYNTHETIC_DATA:'true',AIA_STAGE_PROJECT:'aia-accreditation-staging',MINIO_ENDPOINT:'https://minio:9000',MINIO_PHOTOS_BUCKET:'aia-accreditation-staging-photos',MINIO_REGION:'us-east-1',MINIO_ACCESS_KEY:'aia_staging_root',MINIO_SECRET_KEY:'PRIVATE_ROOT_FIXTURE',AIA_STAGE_S3_WEB_PASSWORD:'PRIVATE_WEB_FIXTURE',AIA_STAGE_S3_WORKER_PASSWORD:'PRIVATE_WORKER_FIXTURE'};
 const error=(name,status)=>Object.assign(new Error('PRIVATE_ERROR_PAYLOAD'),{name,$metadata:{httpStatusCode:status}});
 const names=['CreateBucketCommand','DeleteObjectCommand','GetObjectCommand','HeadObjectCommand','GetBucketVersioningCommand','HeadBucketCommand','GetBucketPolicyCommand','ListObjectsV2Command','ListObjectVersionsCommand','PutObjectCommand','ListBucketsCommand'];
 const sdk=Object.fromEntries(names.map(name=>[name,class {constructor(input){this.input=input;this.operation=name;}}]));
 sdk.S3Client=class {
  constructor(options){this.role=options.credentials.accessKeyId==='aia_staging_root'?'admin':options.credentials.accessKeyId.endsWith('web')?'web':'worker';}
  destroy(){}
  async send(command){
   const {operation,input}=command;commands.push({role:this.role,operation,versionId:input.VersionId,versionRequested:Object.hasOwn(input,'VersionId')&&input.VersionId!==undefined,...(operation==='CreateBucketCommand'?{bucket:input.Bucket,location:input.CreateBucketConfiguration}: {})});
   if(operation==='ListBucketsCommand')return {Buckets:bucketExists?[{Name:env.MINIO_PHOTOS_BUCKET}]:[]};
   if(operation==='CreateBucketCommand'){
    if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.Bucket)||failure==='invalid-create-name')throw error('InvalidBucketName',400);
    if(input.CreateBucketConfiguration)throw error('InvalidLocationConstraint',400);
    throw error('AccessDenied',403);
   }
   if(operation==='GetBucketVersioningCommand'){
    if(failure==='web-versioning'&&this.role==='web')throw error('AccessDenied',403);return {};
   }
   if(operation==='GetBucketPolicyCommand')throw error('NoSuchBucketPolicy',404);
   if(operation==='HeadBucketCommand')return {};
   if(operation==='PutObjectCommand'){
    if(input.IfNoneMatch==='*'&&objects.has(input.Key))throw error('PreconditionFailed',412);
    objects.set(input.Key,Buffer.from(input.Body));return {};
   }
   if(operation==='GetObjectCommand'){
    if(!objects.has(input.Key))throw error('NoSuchKey',404);
    const body=objects.get(input.Key);return {Body:{transformToByteArray:async()=>body,transformToString:async()=>body.toString()}};
   }
   if(operation==='HeadObjectCommand'){if(!objects.has(input.Key))throw error('NotFound',404);return {};}
   if(operation==='ListObjectsV2Command')return {Contents:[...objects].filter(([k])=>k.startsWith(input.Prefix??'')).map(([Key,body])=>({Key,Size:body.length,LastModified:new Date()}))};
   if(operation==='ListObjectVersionsCommand')return {Versions:[...objects.keys()].filter(k=>k.startsWith(input.Prefix)).map(Key=>failure==='missing-version-id'?{Key}:{Key,VersionId:failure==='historical-version-id'?'synthetic-returned-version':'null'})};
   if(operation==='DeleteObjectCommand'){
    if(failure==='paid-version-delete'&&input.VersionId!==undefined)throw error('XMinioPaidTierLicenseRequired',405);
    objects.delete(input.Key);return {};
   }
   throw new Error('Unsupported fixture command');
  }
 };
 const fs={mkdir:async()=>{},copyFile:async()=>{},readFile:async p=>{
  const role=p.endsWith('web.env')?'web':'worker';return JSON.stringify({MINIO_ENDPOINT:env.MINIO_ENDPOINT,MINIO_PHOTOS_BUCKET:env.MINIO_PHOTOS_BUCKET,MINIO_REGION:env.MINIO_REGION,MINIO_ACCESS_KEY:'aia_staging_'+role,MINIO_SECRET_KEY:env['AIA_STAGE_S3_'+role.toUpperCase()+'_PASSWORD']});
 },writeFile:async(p,data)=>{if(p==='/backups/storage-check.json')report=JSON.parse(data);}};
 const spawnSync=(_binary,args)=>{
  if(args.includes('mb'))bucketExists=true;
  if(failure==='policy-create'&&args.includes('policy')&&args.includes('create'))return {status:1,stdout:JSON.stringify({error:{cause:{error:{Code:'AccessDenied',StatusCode:403,Message:'PRIVATE_CLI_PAYLOAD'}}}})};
  return {status:0,stdout:'PRIVATE_CLI_OUTPUT_DISCARDED',stderr:''};
 };
 const context=vm.createContext({Buffer,URL,AbortSignal,process:{env,exitCode:0},console:{log:x=>outputs.push(x),error:x=>outputs.push(x)},fetch:async()=>({status:403}),setTimeout,clearTimeout});
 function synthetic(exports){return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});}
 const appSource=stripTypeScriptTypes(await readFile('/opt/aia-accreditation/packages/storage/src/object-storage.ts','utf8'));
 const app=new vm.SourceTextModule(appSource,{context,identifier:'app-storage'});
 await app.link(specifier=>{assert.equal(specifier,'@aws-sdk/client-s3');return synthetic(sdk);});await app.evaluate();
 const diag=new vm.SourceTextModule(await readFile(root+'/runtime/storage-diagnostics.mjs','utf8'),{context,identifier:'diagnostics'});
 await diag.link(()=>{throw new Error('unexpected diagnostic dependency');});await diag.evaluate();
 const code=stripTypeScriptTypes(await readFile(root+'/runtime/storage.ts','utf8'));
 const main=new vm.SourceTextModule(code,{context,identifier:'storage',initializeImportMeta(meta){meta.url='file:///app/staging-scripts/storage.ts';}});
 await main.link(specifier=>{
  if(specifier==='node:module')return synthetic({createRequire:()=>()=>sdk});
  if(specifier==='node:child_process')return synthetic({spawnSync});
  if(specifier==='node:fs/promises')return synthetic(fs);
  if(specifier==='node:crypto')return synthetic({randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`});
  if(specifier==='dotenv')return synthetic({parse:JSON.parse});
  if(specifier.includes('object-storage.ts'))return app;
  if(specifier==='./storage-diagnostics.mjs')return diag;
  throw new Error('Unexpected dependency '+specifier);
 });
 await main.evaluate();
 assert(report);
 for(const secret of ['PRIVATE_ROOT_FIXTURE','PRIVATE_WEB_FIXTURE','PRIVATE_WORKER_FIXTURE','PRIVATE_ERROR_PAYLOAD','PRIVATE_CLI_PAYLOAD','PRIVATE_CLI_OUTPUT_DISCARDED']){
  assert(!JSON.stringify(report).includes(secret));assert(!outputs.join('\n').includes(secret));
 }
 return {report,commands};
}
const pass=await scenario(null);
assert.equal(pass.report.passed,true);
assert.equal(new Set(pass.commands.filter(x=>x.versionRequested).map(x=>x.role)).size,3);
const probes=pass.commands.filter(x=>x.operation==='CreateBucketCommand');
assert.equal(probes.length,2);
assert.notEqual(probes[0].bucket,probes[1].bucket);
for(const probe of probes){assert.equal(probe.bucket.length,49);assert.equal(probe.location,undefined);}
for(const role of ['admin','web','worker']){
 const result=pass.report.operations.find(x=>x.role===role&&x.operation==='DELETE_OBJECT_WITH_RETURNED_VERSION_ID');
 assert.equal(result.returnedVersionIdUsed,true);assert.equal(result.versionIdKind,'null-version');
}
const policy=await scenario('policy-create');
assert.equal(policy.report.passed,false);
assert.equal(policy.report.failedStep,'MC_POLICY_CREATE');
assert.equal(policy.report.operations.find(x=>x.operation==='MC_POLICY_CREATE').code,'AccessDenied');
assert(policy.report.operations.some(x=>x.role==='worker'&&x.operation==='PUT_OBJECT'&&x.status==='PASS'));
const iam=await scenario('web-versioning');
assert.equal(iam.report.passed,false);
const failure=iam.report.operations.find(x=>x.role==='web'&&x.operation==='GET_BUCKET_VERSIONING');
assert.equal(failure.status,'FAIL');assert.equal(failure.code,'AccessDenied');assert.equal(failure.classification,1);
assert(iam.report.operations.some(x=>x.role==='web'&&x.operation==='DELETE_OBJECT'&&x.status==='PASS'));
const paid=await scenario('paid-version-delete');
assert.equal(paid.report.passed,false);
for(const role of ['admin','web','worker']){
 assert(paid.report.operations.some(x=>x.role===role&&x.operation==='DELETE_OBJECT'&&x.status==='PASS'));
 assert(paid.report.operations.some(x=>x.role===role&&x.operation==='DELETE_OBJECT_WITH_RETURNED_VERSION_ID'&&x.classification===3));
 assert(paid.report.operations.some(x=>x.role===role&&x.operation==='APPLICATION_ERASE_PHOTO_AND_VERIFY'&&x.classification===3));
}
const missing=await scenario('missing-version-id');
assert.equal(missing.report.passed,false);
assert(missing.report.operations.some(x=>x.operation==='DELETE_OBJECT_WITH_RETURNED_VERSION_ID'&&x.status==='BLOCKED'));
assert(!missing.commands.some(x=>x.versionRequested));
const historical=await scenario('historical-version-id');
assert.equal(historical.report.passed,true);
assert(historical.commands.filter(x=>x.versionRequested).every(x=>x.versionId==='synthetic-returned-version'));
assert(historical.report.operations.filter(x=>x.operation==='DELETE_OBJECT_WITH_RETURNED_VERSION_ID').every(x=>x.returnedVersionIdUsed===true&&x.versionIdKind==='version-id'));
const invalid=await scenario('invalid-create-name');
assert.equal(invalid.report.passed,false);
for(const role of ['web','worker']){
 const result=invalid.report.operations.find(x=>x.role===role&&x.operation==='CREATE_BUCKET_DENIED');
 assert.equal(result.status,'FAIL');assert.equal(result.httpStatus,400);assert.equal(result.code,'InvalidBucketName');assert.equal(result.classification,2);
}
console.log('PASS: seven full-runtime scenarios; real-length unique bucket probes, strict 403 denial, explicit returned-version deletion, unchanged app routine, policy failure isolation and paid-tier refusal; no external operations.');
