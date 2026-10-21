// New production bucket and IAM only. Exact application erasure remains a mandatory gate.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createObjectStorage} from '../packages/storage/src/object-storage.ts';
import {check,safe,project,bucket} from './guard.ts';
const sdk=createRequire(new URL('../packages/storage/package.json',import.meta.url))('@aws-sdk/client-s3');
const endpoint='https://minio:9000',region='us-east-1';
await safe(async()=>{
  check(process.env.DEPLOYMENT_ENV==='production'&&process.env.MINIO_ENDPOINT===endpoint&&process.env.MINIO_PHOTOS_BUCKET===bucket,'PRODUCTION_STORAGE_TARGET_REQUIRED');
  const rootUser=(await readFile('/run/secrets/minio_root_user','utf8')).trim(),rootPassword=(await readFile('/run/secrets/minio_root_password','utf8')).trim();
  check(rootUser==='aia_production_root'&&/^[a-f0-9]{64}$/.test(rootPassword),'PRODUCTION_ROOT_IDENTITY_REQUIRED');
  await mkdir('/tmp/mc/certs/CAs',{recursive:true,mode:0o700});await writeFile('/tmp/mc/certs/CAs/ca.crt',await readFile('/run/secrets/ca_cert'),{mode:0o600});
  const mc=(args:string[],input?:string)=>{
    // Credentials are in process memory/environment or pipe, never command arguments.
    // All mc stdout/stderr is discarded: JSON user-add output can include secret keys.
    const r=spawnSync('/usr/local/bin/mc',['--config-dir','/tmp/mc',...args],{env:{PATH:process.env.PATH,HOME:'/tmp',SSL_CERT_FILE:'/run/secrets/ca_cert',MC_HOST_production:`https://${rootUser}:${rootPassword}@minio:9000`},input,stdio:['pipe','ignore','ignore'],timeout:30000});
    check(r.status===0,'STORAGE_ADMIN_OPERATION_FAILED');
  };
  const client=(accessKeyId:string,secretAccessKey:string)=>new sdk.S3Client({endpoint,region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}});
  const root=client(rootUser,rootPassword);
  try{
    if(process.argv[2]==='provision'){
      const all=await root.send(new sdk.ListBucketsCommand({}));check((all.Buckets??[]).every((b:{Name?:string})=>b.Name===bucket),'PRODUCTION_CLUSTER_BUCKET_SCOPE_MISMATCH');
      if(!(all.Buckets??[]).length){await root.send(new sdk.CreateBucketCommand({Bucket:bucket}));await root.send(new sdk.PutObjectCommand({Bucket:bucket,Key:'_production/provisioning.json',Body:JSON.stringify({project}),IfNoneMatch:'*'}));}
      else {const r=await root.send(new sdk.GetObjectCommand({Bucket:bucket,Key:'_production/provisioning.json'}));check(JSON.parse(await r.Body.transformToString()).project===project,'EXISTING_BUCKET_MARKER_MISMATCH');}
      const v=await root.send(new sdk.GetBucketVersioningCommand({Bucket:bucket}));check(!v.Status,'UNVERSIONED_BUCKET_REQUIRED_BY_BACKUP');
      for(const role of ['web','worker','backup']){
        const name='aia_production_'+role,secret=process.env['AIA_PROD_S3_'+role.toUpperCase()+'_PASSWORD'];check(secret&&/^[a-f0-9]{64}$/.test(secret),'SCOPED_SECRET_REQUIRED');
        const actions=role==='backup'?['s3:GetObject']:['s3:GetObject','s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'];
        const policy={Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['s3:GetBucketLocation','s3:GetBucketVersioning','s3:GetBucketPolicy','s3:ListBucket',...(role==='backup'?[]:['s3:ListBucketVersions'])],Resource:['arn:aws:s3:::'+bucket]},{Effect:'Allow',Action:actions,Resource:['arn:aws:s3:::'+bucket+'/*']}]};
        const file='/tmp/'+role+'-policy.json';await writeFile(file,JSON.stringify(policy),{mode:0o600});
        mc(['admin','policy','create','production','aia-production-'+role,file]);
        mc(['admin','user','add','production'],name+'\n'+secret+'\n');
        mc(['admin','policy','attach','production','aia-production-'+role,'--user',name]);
      }
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
