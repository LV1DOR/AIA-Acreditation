import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
import type {PrismaClient} from '../../packages/database/src/index.ts';
import {transaction} from '../../packages/domain/src/shared/transaction.ts';
const fromDatabase=createRequire(new URL('../../packages/database/package.json',import.meta.url));
const fromAdapter=createRequire(fromDatabase.resolve('@prisma/adapter-pg'));
const {DriverAdapterError}=fromAdapter('@prisma/driver-adapter-utils') as {DriverAdapterError:new(cause:{kind:string;originalCode:string})=>Error};
it.each(['40001','40P01'])('retries the installed adapter commit conflict %s',async code=>{
 const run=vi.fn().mockRejectedValueOnce(new DriverAdapterError({kind:'TransactionWriteConflict',originalCode:code})).mockResolvedValue('committed');
 expect(await transaction({$transaction:run} as unknown as PrismaClient,async()=> 'committed')).toBe('committed');expect(run).toHaveBeenCalledTimes(2);
});
it('bounds persistent adapter conflicts to three attempts and returns the existing stale-write error',async()=>{
 const run=vi.fn().mockRejectedValue(new DriverAdapterError({kind:'TransactionWriteConflict',originalCode:'40001'}));
 await expect(transaction({$transaction:run} as unknown as PrismaClient,async()=>null)).rejects.toMatchObject({code:'STALE_WRITE'});expect(run).toHaveBeenCalledTimes(3);
});
it('does not retry unrelated adapter failures or arbitrary lookalike errors',async()=>{
 for(const error of [new DriverAdapterError({kind:'UniqueConstraintViolation',originalCode:'23505'}),Object.assign(new Error('TransactionWriteConflict'),{cause:{kind:'TransactionWriteConflict',originalCode:'40001'}})]){const run=vi.fn().mockRejectedValue(error);await expect(transaction({$transaction:run} as unknown as PrismaClient,async()=>null)).rejects.toBe(error);expect(run).toHaveBeenCalledTimes(1);}
});
