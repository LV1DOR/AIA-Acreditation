// Synthetic storage-only diagnostics. No DB connection or application-code change.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {parse} from 'dotenv';
import {createObjectStorage} from '../packages/storage/src/object-storage.ts';
import {check,cliFailure,createDiagnostics,createBucketProbeInput,expectFailure,safeError} from './storage-diagnostics.mjs';
const sdk=createRequire(new URL('../packages/storage/package.json',import.meta.url))('@aws-sdk/client-s3');
const d=createDiagnostics(),project='aia-accreditation-staging';
const evidence:any={project,synthetic:true,passed:false,steps:[],operations:d.operations};
const bucket='aia-accreditation-staging-photos',endpoint='https://minio:9000';
const clients:any[]=[];
const send=(c:any,command:any)=>c.send(command,{abortSignal:AbortSignal.timeout(15000)});
const client=(accessKey:string,secretKey:string)=>{
 const c=new sdk.S3Client({endpoint,region:process.env.MINIO_REGION,forcePathStyle:true,credentials:{accessKeyId:accessKey,secretAccessKey:secretKey}});clients.push(c);return c;
};
const mc=(args:string[])=>{
 const env:Record<string,string|undefined>={...process.env,SSL_CERT_FILE:'/run/secrets/ca_cert',MC_CONFIG_DIR:'/tmp/aistor-mc'};
 delete env.MC_INSECURE;delete env.MC_DEBUG;
 const r=spawnSync('/usr/local/bin/mc',['--json','--config-dir','/tmp/aistor-mc',...args],{env,encoding:'utf8',maxBuffer:1024*1024,timeout:30000});
 if(r.status!==0)throw cliFailure(r); // Raw CLI output/arguments are never retained.
};
async function objectChecks(c:any,storage:any,role:string){
 const run=(op:string,fn:()=>any,fallback:number|null=null)=>d.run('OBJECTS',op,role,fn,fallback);
 // Readiness calls are separate so HeadBucket, policy and versioning cannot hide each other.
 await run('HEAD_BUCKET',()=>send(c,new sdk.HeadBucketCommand({Bucket:bucket})));
 await run('GET_BUCKET_POLICY',async()=>{
  try{const p=await send(c,new sdk.GetBucketPolicyCommand({Bucket:bucket}));check(!JSON.parse(p.Policy??'{}').Statement?.length,'BUCKET_POLICY_MUST_BE_PRIVATE');}
  catch(e){if(safeError(e).code!=='NoSuchBucketPolicy')throw e;}
 },1);
 await run('GET_BUCKET_VERSIONING',async()=>{const v=await send(c,new sdk.GetBucketVersioningCommand({Bucket:bucket}));check(!v.Status,'VERSIONING_MUST_BE_DISABLED');},1);
 const key='_staging/probe/'+randomUUID(),body=Buffer.from('SYNTHETIC STORAGE DIAGNOSTIC');
 const put=await run('PUT_OBJECT',()=>storage.putPhoto(key,body));
 if(put.ok){
  await run('GET_OBJECT',async()=>check(Buffer.from(await storage.getPhoto(key)).equals(body),'CONTENT_MISMATCH'),4);
  await run('HEAD_OBJECT',()=>send(c,new sdk.HeadObjectCommand({Bucket:bucket,Key:key})));
  await run('LIST_OBJECTS',async()=>check((await storage.listObjects(key)).objects.some((x:{key:string})=>x.key===key),'EXPECTED_OBJECT_LIST_ENTRY'),4);
  await run('ANONYMOUS_GET_DENIED',async()=>check((await fetch(endpoint+'/'+bucket+'/'+key,{signal:AbortSignal.timeout(5000)})).status===403,'EXPECTED_ACCESS_DENIED'),1);
  await run('CONDITIONAL_PUT_REJECTS_DUPLICATE',()=>expectFailure(()=>storage.putPhoto(key,Buffer.from('MUST NOT OVERWRITE')),'PreconditionFailed',412,'EXPECTED_PRECONDITION_FAILED'),4);
  await run('CONDITIONAL_PUT_PRESERVES_CONTENT',async()=>check(Buffer.from(await storage.getPhoto(key)).equals(body),'CONTENT_MISMATCH'),4);
 }else for(const op of ['GET_OBJECT','HEAD_OBJECT','LIST_OBJECTS','ANONYMOUS_GET_DENIED','CONDITIONAL_PUT_REJECTS_DUPLICATE','CONDITIONAL_PUT_PRESERVES_CONTENT'])d.blocked('OBJECTS',op,role);
 const ordinary=key+'-ordinary',ordinaryPut=await run('PUT_ORDINARY_DELETE_FIXTURE',()=>storage.putPhoto(ordinary,body));
 if(ordinaryPut.ok){
  const deleted=await run('DELETE_OBJECT',()=>storage.deletePhoto(ordinary));
  if(deleted.ok)await run('VERIFY_ORDINARY_DELETE',()=>expectFailure(()=>send(c,new sdk.HeadObjectCommand({Bucket:bucket,Key:ordinary})),['NotFound','NoSuchKey'],404,'EXPECTED_ABSENCE'),4);
  else d.blocked('OBJECTS','VERIFY_ORDINARY_DELETE',role);
 }else{d.blocked('OBJECTS','DELETE_OBJECT',role);d.blocked('OBJECTS','VERIFY_ORDINARY_DELETE',role);}
 const exact=key+'-version',exactPut=await run('PUT_VERSION_DELETE_FIXTURE',()=>storage.putPhoto(exact,body));
 if(exactPut.ok){
  const versions=await run('LIST_OBJECT_VERSIONS',async()=>{
   const p=await send(c,new sdk.ListObjectVersionsCommand({Bucket:bucket,Prefix:exact}));
   const matches=(p.Versions??[]).filter((v:{Key?:string})=>v.Key===exact);
   check(matches.length>0&&matches.every((v:{VersionId?:string})=>typeof v.VersionId==='string'&&v.VersionId.length>0),'MISSING_VERSION_ENTRY');return matches;
  },4);
  if(versions.ok){
   const exactDelete=await run('DELETE_OBJECT_WITH_RETURNED_VERSION_ID',async()=>{
    for(const v of versions.value)await send(c,new sdk.DeleteObjectCommand({Bucket:bucket,Key:exact,VersionId:v.VersionId}));
   });
   if(exactDelete.ok)Object.assign(d.operations[d.operations.length-1],{returnedVersionIdUsed:true,versionIdKind:versions.value.every((v:{VersionId:string})=>v.VersionId==='null')?'null-version':'version-id'});
  }else d.blocked('OBJECTS','DELETE_OBJECT_WITH_RETURNED_VERSION_ID',role);
 }else{d.blocked('OBJECTS','LIST_OBJECT_VERSIONS',role);d.blocked('OBJECTS','DELETE_OBJECT_WITH_RETURNED_VERSION_ID',role);}
 // A fresh fixture runs the real routine; ordinary DELETE never substitutes for it.
 const erase=key+'-application',erasePut=await run('PUT_APPLICATION_ERASURE_FIXTURE',()=>storage.putPhoto(erase,body));
 if(erasePut.ok)await run('APPLICATION_ERASE_PHOTO_AND_VERIFY',()=>storage.erasePhotoAndVerify(erase),4);
 else d.blocked('OBJECTS','APPLICATION_ERASE_PHOTO_AND_VERIFY',role);
 if(role!=='admin'){
  // AccessDenied specifically; invalid credentials returning some other 403 do not prove scope.
  await d.run('IAM','CREATE_BUCKET_DENIED',role,()=>{
   const request=createBucketProbeInput(randomUUID(),process.env.MINIO_REGION);
   return expectFailure(()=>send(c,new sdk.CreateBucketCommand(request)),'AccessDenied',403,'EXPECTED_ACCESS_DENIED');
  },1);
 }
}
try{
 const target=await d.run('CONFIG','VALIDATE_SYNTHETIC_TARGET','admin',()=>{
  check(process.env.DEPLOYMENT_ENV==='staging'&&process.env.AIA_SYNTHETIC_DATA==='true'&&process.env.AIA_STAGE_PROJECT===project,'TARGET_MISMATCH');
  check(process.env.MINIO_ENDPOINT===endpoint&&process.env.MINIO_PHOTOS_BUCKET===bucket&&process.env.MINIO_ACCESS_KEY==='aia_staging_root','TARGET_MISMATCH');
 },1);
 if(target.ok){
  await mkdir('/tmp/aistor-mc/certs/CAs',{recursive:true,mode:0o700});await copyFile('/run/secrets/ca_cert','/tmp/aistor-mc/certs/CAs/ca.crt');
  const connected=await d.run('TLS','MC_ALIAS_SET','admin',()=>mc(['alias','set','stage',endpoint,process.env.MINIO_ACCESS_KEY!,process.env.MINIO_SECRET_KEY!]));
  if(connected.ok)await d.run('LICENSE','MC_LICENSE_INFO','admin',()=>mc(['license','info','stage']));
  const root=client(process.env.MINIO_ACCESS_KEY!,process.env.MINIO_SECRET_KEY!);
  const list=await d.run('BUCKET','LIST_BUCKETS_AND_CHECK_SCOPE','admin',async()=>{
   const p=await send(root,new sdk.ListBucketsCommand({}));check((p.Buckets??[]).every((b:{Name?:string})=>b.Name===bucket),'BUCKET_SCOPE_MISMATCH');return p.Buckets??[];
  },1);
  let marked=false;
  if(list.ok){
   if(!list.value.length){
    const created=await d.run('BUCKET','CREATE_NEW_BUCKET','admin',()=>mc(['mb','stage/'+bucket]));
    if(created.ok){const marker=await d.run('BUCKET','PUT_SYNTHETIC_MARKER','admin',()=>send(root,new sdk.PutObjectCommand({Bucket:bucket,Key:'_staging/provisioning.json',Body:JSON.stringify({project,synthetic:true}),IfNoneMatch:'*'})));marked=marker.ok;}
   }else{
    const marker=await d.run('BUCKET','VERIFY_SYNTHETIC_MARKER','admin',async()=>{
     const m=await send(root,new sdk.GetObjectCommand({Bucket:bucket,Key:'_staging/provisioning.json'}));const v=JSON.parse(await m.Body.transformToString());check(v.project===project&&v.synthetic===true,'MARKER_MISMATCH');
    },1);marked=marker.ok;
   }
  }
  const version=marked?await d.run('BUCKET','VERIFY_UNVERSIONED','admin',async()=>{const v=await send(root,new sdk.GetBucketVersioningCommand({Bucket:bucket}));check(!v.Status,'VERSIONING_MUST_BE_DISABLED');},1):{ok:false};
  const privacy=marked?await d.run('BUCKET','VERIFY_PRIVATE_POLICY','admin',async()=>{
   try{const p=await send(root,new sdk.GetBucketPolicyCommand({Bucket:bucket}));check(!JSON.parse(p.Policy??'{}').Statement?.length,'BUCKET_POLICY_MUST_BE_PRIVATE');}
   catch(e){if(safeError(e).code!=='NoSuchBucketPolicy')throw e;}
  },1):{ok:false};
  if(marked&&version.ok&&privacy.ok){
   const policy={Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['s3:GetBucketLocation','s3:GetBucketVersioning','s3:ListBucket','s3:ListBucketVersions','s3:GetBucketPolicy'],Resource:['arn:aws:s3:::'+bucket]},{Effect:'Allow',Action:['s3:GetObject','s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'],Resource:['arn:aws:s3:::'+bucket+'/*']}]};
   await writeFile('/tmp/aistor-s3-policy.json',JSON.stringify(policy),{mode:0o600});
   await d.run('IAM','MC_POLICY_CREATE','admin',()=>mc(['admin','policy','create','stage','aia-photos','/tmp/aistor-s3-policy.json']));
   for(const role of ['web','worker']){
    const configured=await d.run('CONFIG','READ_AND_VALIDATE_SCOPED_ENV',role,async()=>{
     const e=parse(await readFile('/run/operator-secrets/'+role+'.env'));
     check(e.MINIO_ACCESS_KEY==='aia_staging_'+role&&e.MINIO_PHOTOS_BUCKET===bucket&&e.MINIO_ENDPOINT===endpoint&&e.MINIO_SECRET_KEY===process.env['AIA_STAGE_S3_'+role.toUpperCase()+'_PASSWORD'],'CREDENTIAL_CONFIG_MISMATCH');return e;
    },1);
    if(!configured.ok)continue;
    const e=configured.value;
    await d.run('IAM','MC_USER_ADD',role,()=>mc(['admin','user','add','stage',e.MINIO_ACCESS_KEY!,e.MINIO_SECRET_KEY!]));
    await d.run('IAM','MC_POLICY_ATTACH',role,()=>mc(['admin','policy','attach','stage','aia-photos','--user',e.MINIO_ACCESS_KEY!]));
    const c=client(e.MINIO_ACCESS_KEY!,e.MINIO_SECRET_KEY!);
    const storage=createObjectStorage({endpoint,region:e.MINIO_REGION!,bucket,accessKey:e.MINIO_ACCESS_KEY!,secretKey:e.MINIO_SECRET_KEY!});
    await objectChecks(c,storage,role);
   }
   const rootStorage=createObjectStorage({endpoint,region:process.env.MINIO_REGION!,bucket,accessKey:process.env.MINIO_ACCESS_KEY!,secretKey:process.env.MINIO_SECRET_KEY!});
   await objectChecks(root,rootStorage,'admin');
  }
 }
}catch(error){await d.run('TEST','INTERNAL_TEST_EXCEPTION','admin',()=>{throw error;},2);}
finally{
 for(const c of clients)c.destroy();
 const failed=d.operations.filter(x=>x.status==='FAIL');
 evidence.passed=failed.length===0&&d.operations.some(x=>x.role==='worker'&&x.operation==='APPLICATION_ERASE_PHOTO_AND_VERIFY'&&x.status==='PASS')&&!d.operations.some(x=>x.status==='BLOCKED');
 evidence.steps=d.operations.filter(x=>x.status==='PASS').map(x=>x.role+'_'+x.operation);
 if(!evidence.passed){evidence.failedStep=failed[0]?.operation??'INCOMPLETE_TEST';evidence.paidFeatureRequired=failed.some(x=>x.classification===3);process.exitCode=1;}
 await writeFile('/backups/storage-check.json',JSON.stringify(evidence,null,2),{mode:0o600});
 for(const r of d.operations)console.log(JSON.stringify(r));
 console.log(evidence.passed?'STORAGE_CHECK_PASSED':'STORAGE_CHECK_FAILED_'+evidence.failedStep);
}
