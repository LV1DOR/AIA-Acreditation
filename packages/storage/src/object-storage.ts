import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, GetBucketVersioningCommand, HeadBucketCommand, GetBucketPolicyCommand, ListObjectsV2Command, ListObjectVersionsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type StorageOptions = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
};

export function createObjectStorage(options: StorageOptions) {
  const client = new S3Client({
    endpoint: options.endpoint,
    forcePathStyle: true,
    region: options.region,
    credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
  });
  return {
    async checkBackupCompatible(){const v=await client.send(new GetBucketVersioningCommand({Bucket:options.bucket}),{abortSignal:AbortSignal.timeout(5000)});if(v.Status)throw new Error("VERSIONED_BACKUP_ADAPTER_REQUIRED");},
    async checkReady(privateRequired=false) {
      await client.send(new HeadBucketCommand({Bucket:options.bucket}),{abortSignal:AbortSignal.timeout(5000)});
      if(privateRequired) {
        try {const p=await client.send(new GetBucketPolicyCommand({Bucket:options.bucket}),{abortSignal:AbortSignal.timeout(5000)});const policy=JSON.parse(p.Policy??"{}");if(policy.Statement?.some((s:{Effect:string;Principal:unknown})=>s.Effect==="Allow" && (s.Principal==="*" || JSON.stringify(s.Principal).includes('"*"'))))throw new Error("PUBLIC_BUCKET_FORBIDDEN");}
        catch(e){if((e as {name?:string}).name!=="NoSuchBucketPolicy")throw e;}
      }
    },
    async listObjects(prefix="",limit=1000) {
      const objects:{key:string;lastModified:Date;size:number}[]=[];let token:string|undefined;
      do {const page=await client.send(new ListObjectsV2Command({Bucket:options.bucket,Prefix:prefix,ContinuationToken:token,MaxKeys:Math.min(1000,limit-objects.length)}),{abortSignal:AbortSignal.timeout(10000)});for(const x of page.Contents??[])if(x.Key)objects.push({key:x.Key,lastModified:x.LastModified??new Date(0),size:x.Size??0});token=page.NextContinuationToken;if(objects.length>=limit)break;}while(token);
      return {objects,truncated:Boolean(token)};
    },
    async erasePhotoAndVerify(key:string) {
      // Delete markers alone leave historical versions accessible. Remove every exact-key version.
      let marker:string|undefined,versionMarker:string|undefined;
      do {
        const page=await client.send(new ListObjectVersionsCommand({Bucket:options.bucket,Prefix:key,KeyMarker:marker,VersionIdMarker:versionMarker}),{abortSignal:AbortSignal.timeout(10000)});
        for(const v of [...page.Versions??[],...page.DeleteMarkers??[]])if(v.Key===key)await client.send(new DeleteObjectCommand({Bucket:options.bucket,Key:key,VersionId:v.VersionId}),{abortSignal:AbortSignal.timeout(30000)});
        marker=page.NextKeyMarker;versionMarker=page.NextVersionIdMarker;
      }while(marker);
      // Also covers non-versioned stores; storage lock/permission errors remain failures.
      try {await client.send(new HeadObjectCommand({Bucket:options.bucket,Key:key}));await client.send(new DeleteObjectCommand({Bucket:options.bucket,Key:key}),{abortSignal:AbortSignal.timeout(30000)});}
      catch(e){if(!["NotFound","NoSuchKey"].includes((e as {name:string}).name))throw e;}
      const remaining=await client.send(new ListObjectVersionsCommand({Bucket:options.bucket,Prefix:key}),{abortSignal:AbortSignal.timeout(10000)});
      if([...remaining.Versions??[],...remaining.DeleteMarkers??[]].some(v=>v.Key===key))throw new Error("STORAGE_COPY_REMAINS");
      try {await client.send(new HeadObjectCommand({Bucket:options.bucket,Key:key}),{abortSignal:AbortSignal.timeout(5000)});throw new Error("STORAGE_COPY_REMAINS");}catch(e){if(!["NotFound","NoSuchKey"].includes((e as {name:string}).name))throw e;}
    },
    async ensureBucket() {
      try { await client.send(new HeadBucketCommand({ Bucket: options.bucket })); }
      catch { await client.send(new CreateBucketCommand({ Bucket: options.bucket })); }
    },
    async putPhoto(key: string, body: Uint8Array) {
      await client.send(new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: body, IfNoneMatch: "*", ContentType: "image/jpeg", CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(60_000) });
    },
    async getPhoto(key: string) {
      const result = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }),{abortSignal:AbortSignal.timeout(30000)});
      if (!result.Body) throw new Error("OBJECT_NOT_FOUND");
      return result.Body.transformToByteArray();
    },
    async deletePhoto(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
    },
  };
}

