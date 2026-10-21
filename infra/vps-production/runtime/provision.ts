// Manual one-shot adapter only. No seed records, no staging imports, no resets.
import {readFile} from 'node:fs/promises';
import {createDatabase} from '../packages/database/src/index.ts';
import {check,target,marked,safe,project,databaseName} from './guard.ts';
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
await safe(async()=>{
  target(process.env.AIA_CLUSTER_DATABASE_URL,'aia_cluster_admin','postgres');
  const root=createDatabase(process.env.AIA_CLUSTER_DATABASE_URL!);
  try{
    const action=process.argv[2];
    if(action==='init'){
      const others=await root.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')`;
      check(!others.length,'NEW_EMPTY_PRODUCTION_CLUSTER_REQUIRED');
      for(const name of ['aia_privacy_owner','aia_privacy_executor','aia_runtime','aia_backup'])await root.$executeRawUnsafe(`CREATE ROLE ${name} NOLOGIN`);
      for(const [role,key]of [['aia_migrator','MIGRATOR'],['aia_web','WEB'],['aia_worker','WORKER'],['aia_erasure','ERASURE'],['aia_backup_reader','BACKUP'],['aia_backup_ledger','LEDGER']]){
        const p=process.env['AIA_PROD_'+key+'_PASSWORD'];check(p&&/^[a-f0-9]{64}$/.test(p),'DISTINCT_DATABASE_PASSWORD_REQUIRED');
        await root.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${literal(p)}`);
      }
      await root.$executeRawUnsafe('GRANT aia_privacy_owner TO aia_migrator');
      await root.$executeRawUnsafe('GRANT aia_privacy_executor TO aia_erasure');
      await root.$executeRawUnsafe("ALTER ROLE aia_migrator SET lock_timeout='5s'");
      await root.$executeRawUnsafe("ALTER ROLE aia_migrator SET statement_timeout='10min'");
      await root.$executeRawUnsafe('CREATE DATABASE '+databaseName+' OWNER aia_migrator');
      await root.$executeRawUnsafe('COMMENT ON DATABASE '+databaseName+' IS '+literal(project+'-fresh-only'));
      const u=new URL(process.env.AIA_CLUSTER_DATABASE_URL!);u.pathname='/'+databaseName;const db=createDatabase(u.toString());
      try{await marked(db);await db.$executeRawUnsafe('REVOKE CONNECT ON DATABASE '+databaseName+' FROM PUBLIC');await db.$executeRawUnsafe('GRANT CONNECT ON DATABASE '+databaseName+' TO aia_migrator,aia_web,aia_worker,aia_erasure,aia_backup_reader,aia_backup_ledger');await db.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');await db.$executeRawUnsafe('GRANT USAGE,CREATE ON SCHEMA public TO aia_privacy_owner');}finally{await db.$disconnect();}
    }else if(action==='grants'){
      target(process.env.MIGRATION_DATABASE_URL,'aia_migrator');const db=createDatabase(process.env.MIGRATION_DATABASE_URL!);
      try{await marked(db);await db.$executeRawUnsafe(await readFile('/app/infra/production/runtime-roles.sql','utf8'));}finally{await db.$disconnect();}
      const u=new URL(process.env.AIA_CLUSTER_DATABASE_URL!);u.pathname='/'+databaseName;const admin=createDatabase(u.toString());
      try{
        await marked(admin);await admin.$executeRawUnsafe('GRANT aia_runtime TO aia_web,aia_worker');await admin.$executeRawUnsafe('GRANT aia_backup TO aia_backup_reader');
        await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO aia_erasure,aia_backup_ledger');
        await admin.$executeRawUnsafe('GRANT SELECT,INSERT,UPDATE ON "BackupRun" TO aia_backup_ledger');
        await admin.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM aia_privacy_owner');
      }finally{await admin.$disconnect();}
    }else throw Error('UNKNOWN_PROVISION_ACTION');
    console.log(JSON.stringify({passed:true,action,project}));
  }finally{await root.$disconnect();}
});
