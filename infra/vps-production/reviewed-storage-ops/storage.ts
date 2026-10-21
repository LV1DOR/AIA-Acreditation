// New production bucket and IAM only. Exact application erasure remains a mandatory gate.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createObjectStorage} from '../packages/storage/src/object-storage.ts';
import {check,safe,project,bucket} from './guard.ts';
import {openAdmin} from './storage-admin.mjs';
import {provisionStorage,markerKey} from './storage-provision.mjs';
const sdk=createRequire(new URL('../packages/storage/package.json',import.meta.url))('@aws-sdk/client-s3');
const endpoint='https://minio:9000',region='us-east-1';
await safe(async()=>{
  check(process.env.DEPLOYMENT_ENV==='production'&&process.env.MINIO_ENDPOINT===endpoint&&process.env.MINIO_PHOTOS_BUCKET===bucket,'PRODUCTION_STORAGE_TARGET_REQUIRED');
  const rootUser=(await readFile('/run/secrets/minio_root_user','utf8')).trim(),rootPassword=(await readFile('/run/secrets/minio_root_password','utf8')).trim();
  check(rootUser==='aia_production_root'&&/^[a-f0-9]{64}$/.test(rootPassword),'PRODUCTION_ROOT_IDENTITY_REQUIRED');
  const client=(accessKeyId:string,secretAccessKey:string)=>new sdk.S3Client({endpoint,region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}});
  const root=client(rootUser,rootPassword);
  try{
    if(process.argv[2]==='provision'){
      const secrets=Object.fromEntries(['web','worker','backup'].map(role=>[role,process.env['AIA_PROD_S3_'+role.toUpperCase()+'_PASSWORD']]));
      const intent='/backups/storage-provision-intent.json';
      const readIntent=async()=>{try{const value=JSON.parse(await readFile(intent,'utf8'));check(value.project===project&&value.bucket===bucket&&value.intent==='CREATE_EMPTY_PRODUCTION_BUCKET','PROVISION_INTENT_MISMATCH');return true;}catch(e){if((e as {code?:string}).code==='ENOENT')return false;throw e;}};
      const iam=await openAdmin({rootUser,rootPassword});
      try{
        await provisionStorage({secrets,iam,journal:{
          hasIntent:readIntent,
          async createIntent(){if(!await readIntent())await writeFile(intent,JSON.stringify({project,bucket,intent:'CREATE_EMPTY_PRODUCTION_BUCKET'}),{mode:0o600,flag:'wx'});}
        },s3:{
          async listBuckets(){const r=await root.send(new sdk.ListBucketsCommand({}));return (r.Buckets??[]).map((b:{Name?:string})=>b.Name);},
          async createBucket(){await root.send(new sdk.CreateBucketCommand({Bucket:bucket}));},
          async versioning(){return root.send(new sdk.GetBucketVersioningCommand({Bucket:bucket}));},
          async getMarker(){const r=await root.send(new sdk.GetObjectCommand({Bucket:bucket,Key:markerKey}));return JSON.parse(await r.Body.transformToString());},
          async listKeys(){const r=await root.send(new sdk.ListObjectsV2Command({Bucket:bucket,MaxKeys:1}));check(!r.IsTruncated,'UNMARKED_BUCKET_NOT_EMPTY');return r.Contents??[];},
          async putMarker(value:unknown){await root.send(new sdk.PutObjectCommand({Bucket:bucket,Key:markerKey,Body:JSON.stringify(value),IfNoneMatch:'*'}));}
        },progress:stage=>console.log(JSON.stringify({passed:true,stage}))});
      }finally{await iam.close();}
      console.log(JSON.stringify({passed:true,action:'PROVISIONED_PRIVATE_UNVERSIONED_STORAGE',erasureVerified:false}));
    }else if(process.argv[2]==='check'){
      const results:{role:string;operation:string;passed:boolean;code?:string}[]=[];
      for(const role of ['web','worker']){
        const secret=process.env['AIA_PROD_S3_'+role.toUpperCase()+'_PASSWORD'];check(secret,'SCOPED_SECRET_REQUIRED');
        const storage=createObjectStorage({endpoint,region,bucket,accessKey:'aia_production_'+role,secretKey:secret});
        const c=client('aia_production_'+role,secret),key='_production-readiness/'+randomUUID();
        const run=async(operation:string,fn:()=>Promise<unknown>)=>{try{await fn();results.push({role,operation,passed:true});}catch(e){const n=e instanceof Error?e.name:'';results.push({role,operation,passed:false,code:/^[A-Za-z0-9_]{1,80}$/.test(n)?n:'SUPPRESSED'});}};
        try{
          await run('PRIVATE_BUCKET_READY',()=>storage.checkReady(true));await run('UNVERSIONED_BACKUP_COMPATIBLE',()=>storage.checkBackupCompatible());
          await run('PUT_GET',async()=>{await storage.putPhoto(key,Buffer.from('SYNTHETIC PRODUCTION READINESS ONLY'));check(Buffer.from(await storage.getPhoto(key)).toString()==='SYNTHETIC PRODUCTION READINESS ONLY','STORAGE_BYTES_MISMATCH');});
          await run('CONDITIONAL_PUT',async()=>{try{await storage.putPhoto(key,Buffer.from('MUST NOT OVERWRITE'));throw Error('CONDITIONAL_WRITE_NOT_REJECTED');}catch(e){check((e as {name:string}).name==='PreconditionFailed','EXPECTED_CONDITIONAL_PRECONDITION');}});
          await run('ANONYMOUS_GET_DENIED',async()=>check((await fetch(endpoint+'/'+bucket+'/'+key,{signal:AbortSignal.timeout(5000)})).status===403,'ANONYMOUS_ACCESS_NOT_DENIED'));
          await run('CREATE_BUCKET_DENIED',async()=>{try{await c.send(new sdk.CreateBucketCommand({Bucket:'aia-production-denied-'+randomUUID()}));throw Error('IAM_TOO_BROAD');}catch(e){check((e as {name:string}).name==='AccessDenied','EXPECTED_ACCESS_DENIED');}});
          await run('APPLICATION_ALL_VERSION_ERASURE',()=>storage.erasePhotoAndVerify(key));
        }finally{c.destroy();}
      }
      await writeFile('/backups/storage-capability.json',JSON.stringify({project,passed:results.every(r=>r.passed),results}),{mode:0o600});
      for(const r of results)console.log(JSON.stringify(r));check(results.every(r=>r.passed),'PRODUCTION_STORAGE_CAPABILITY_GATE_FAILED');
    }else throw Error('UNKNOWN_STORAGE_ACTION');
  }finally{root.destroy();}
});
