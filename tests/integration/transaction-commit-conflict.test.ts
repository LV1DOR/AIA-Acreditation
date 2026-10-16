import {randomUUID} from 'node:crypto';
import {afterAll,expect,it} from 'vitest';
import {db} from './database.ts';
import {transaction} from '../../packages/domain/src/shared/transaction.ts';
afterAll(()=>db.$disconnect());
it('retries a real serializable commit conflict and preserves the shared invariant',async()=>{
 const rows=await Promise.all([0,1].map(()=>db.jobRole.create({data:{name:'Synthetic commit conflict '+randomUUID()}}))),ids=rows.map(r=>r.id);
 let entered=0,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const outcomes=await Promise.all(rows.map(row=>transaction(db,async tx=>{
  const current=await tx.jobRole.findMany({where:{id:{in:ids}},select:{deactivatedAt:true}});
  if(++entered<=2){if(entered===2)release();await gate;}
  if(current.every(r=>r.deactivatedAt===null)){await tx.jobRole.update({where:{id:row.id},data:{deactivatedAt:new Date()}});return 'changed';}
  return 'preserved';
 })));
 expect(outcomes.sort()).toEqual(['changed','preserved']);expect(entered).toBeGreaterThan(2);expect(await db.jobRole.count({where:{id:{in:ids},deactivatedAt:null}})).toBe(1);
});
