import {expect,it,afterAll} from "vitest";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {db} from "./database.ts";
import {fixture} from "../fixtures/foundation.ts";
import {readyPerson} from "../fixtures/security.ts";
import {parseStorageEnv} from "../../packages/config/src/index.ts";
import {createObjectStorage} from "../../packages/storage/src/object-storage.ts";
import {approveEventRetentionPolicy,previewPrivacyErasure,requestPrivacyErasure,executePrivacyDatabaseErasure,cleanupNextStorageDeletion,reconcilePrivacyErasure,attestExternalErasureCopies,assertRestrictedDatabaseRuntime} from "../../packages/domain/src/index.ts";
afterAll(()=>db.$disconnect());
it('F07/08 real MinIO cleanup verifies removal of every object version and remains pending across an interrupted deletion',async()=>{
 const e=parseStorageEnv(process.env);if(!['127.0.0.1','localhost'].includes(new URL(e.MINIO_ENDPOINT).hostname))throw Error('LOCAL_STORAGE_REQUIRED');
 const bucket='aia-phase3-versioned-'+randomUUID(),options={endpoint:e.MINIO_ENDPOINT,accessKey:e.MINIO_ACCESS_KEY,secretKey:e.MINIO_SECRET_KEY,region:e.MINIO_REGION,bucket},storage=createObjectStorage(options);await storage.ensureBucket();
 const {S3Client,PutBucketVersioningCommand,PutObjectCommand,ListObjectVersionsCommand}=createRequire(new URL('../../packages/storage/package.json',import.meta.url))('@aws-sdk/client-s3');const s3=new S3Client({endpoint:e.MINIO_ENDPOINT,forcePathStyle:true,region:e.MINIO_REGION,credentials:{accessKeyId:e.MINIO_ACCESS_KEY,secretAccessKey:e.MINIO_SECRET_KEY}});
 await s3.send(new PutBucketVersioningCommand({Bucket:bucket,VersioningConfiguration:{Status:'Enabled'}}));await expect(storage.checkBackupCompatible()).rejects.toThrow('VERSIONED_BACKUP_ADAPTER_REQUIRED');
 const f=await fixture(db),p=await readyPerson(db,f);await s3.send(new PutObjectCommand({Bucket:bucket,Key:p.photoObjectKey,Body:Buffer.from('SYNTHETIC-VERSION-ONE')}));await s3.send(new PutObjectCommand({Bucket:bucket,Key:p.photoObjectKey,Body:Buffer.from('SYNTHETIC-VERSION-TWO')}));
 await approveEventRetentionPolicy(db,f.adminActor,{eventId:f.event.id,recordsEraseAfter:new Date('2020-01-01'),evidenceEraseAfter:new Date('2020-02-01'),communicationsEraseAfter:new Date('2020-01-01'),backupsEraseAfter:new Date('2035-01-01'),approvalReference:'SYNTHETIC-VERSIONED-ERASURE',approved:true,automaticPurge:false});
 const preview=await previewPrivacyErasure(db,f.adminActor,f.registration.id,'1'.repeat(64));const j=await requestPrivacyErasure(db,f.adminActor,{registrationId:preview.registrationId,expectedVersion:preview.registrationVersion,previewHash:preview.previewHash,authorisationReference:'SYNTHETIC-VERSIONED-AUTH',confirmed:true},'1'.repeat(64),bucket);await executePrivacyDatabaseErasure(db,j.id);
 expect(await cleanupNextStorageDeletion(db,async()=>{throw Error('SYNTHETIC-OUTAGE');},new Date(),j.id)).toBe('RETRY');expect(Buffer.from(await storage.getPhoto(p.photoObjectKey!)).toString()).toBe('SYNTHETIC-VERSION-TWO');expect(await reconcilePrivacyErasure(db,j.id)).toBe('STORAGE_PENDING');
 await db.storageDeletion.updateMany({where:{jobId:j.id},data:{availableAt:new Date(0)}});expect(await cleanupNextStorageDeletion(db,(_,key)=>storage.erasePhotoAndVerify(key),new Date(),j.id)).toBe('VERIFIED');const versions=await s3.send(new ListObjectVersionsCommand({Bucket:bucket,Prefix:p.photoObjectKey}));expect(versions.Versions??[]).toHaveLength(0);expect(versions.DeleteMarkers??[]).toHaveLength(0);
 expect(await attestExternalErasureCopies(db,f.adminActor,j.id,'SYNTHETIC-COPY-VERIFICATION')).toBe('COMPLETE');
 s3.destroy();
});
it('F14 runtime role checks reject a schema-owning superuser and accept a non-owning unprivileged role',async()=>{
 await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aia_phase3_runtime_test') THEN CREATE ROLE aia_phase3_runtime_test NOLOGIN; END IF; END $$`);
 await expect(assertRestrictedDatabaseRuntime(db)).rejects.toThrow('RESTRICTED_RUNTIME_ROLE_REQUIRED');
 await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE aia_phase3_runtime_test');await assertRestrictedDatabaseRuntime(tx);});
});
