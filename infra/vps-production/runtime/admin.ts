// Official bootstrap is imported unchanged. Disable keeps all audit/foreign-key records.
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../packages/database/src/index.ts';
import {parseEnv,parseAuthEnv} from '../packages/config/src/index.ts';
import {check,target,marked,safe} from './guard.ts';
await safe(async()=>{
  const e=parseEnv(process.env);parseAuthEnv(process.env);target(e.DATABASE_URL,'aia_web');
  const db=createDatabase(e.DATABASE_URL);try{
    await marked(db);const action=process.argv[2],id=process.env.CLERK_ADMIN_USER_ID;
    check(id&&/^user_[A-Za-z0-9]+$/.test(id),'INVALID_ADMIN_ID');
    if(action==='bootstrap'){await import('../scripts/bootstrap-admin.ts');}
    else if(action==='disable'){
      check(process.env.ADMIN_BOOTSTRAP_CONFIRM==='DISABLE_SINGLE_ADMIN','EXPLICIT_ADMIN_DISABLE_REQUIRED');
      const ref=process.env.AIA_ADMIN_APPROVAL_REFERENCE;check(ref&&ref.length>=5&&ref.length<=200,'ADMIN_APPROVAL_REFERENCE_REQUIRED');
      await db.$transaction(async tx=>{
        const u=await tx.user.findUniqueOrThrow({where:{clerkUserId:id}});check(u.role==='ADMIN'&&!u.disabledAt,'ACTIVE_ADMIN_TARGET_REQUIRED');
        check(await tx.user.count({where:{role:'ADMIN',disabledAt:null}})>1,'LAST_ACTIVE_ADMIN_CANNOT_BE_DISABLED');
        await tx.user.update({where:{id:u.id},data:{disabledAt:new Date()}});
        await tx.auditEvent.create({data:{actorType:'SYSTEM',action:'OPERATOR_ADMIN_DISABLED',entityType:'User',entityId:u.id,correlationId:randomUUID(),metadata:{approvalReference:ref}}});
      },{isolationLevel:'Serializable'});console.log('SINGLE_ADMIN_DISABLED_HISTORY_PRESERVED');
    }else throw Error('UNKNOWN_ADMIN_ACTION');
  }finally{await db.$disconnect();}
});
