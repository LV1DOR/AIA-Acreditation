import {config} from "dotenv";
import {randomUUID} from "node:crypto";
import {createDatabase} from "../packages/database/src/index.ts";
import {claimDelivery} from "../packages/domain/src/notifications/recovery.ts";
import {transaction} from "../packages/domain/src/shared/transaction.ts";
import {validateDatabaseTarget} from "./lib/targets.ts";
config({quiet:true});const url=process.env.TEST_DATABASE_URL!;validateDatabaseTarget(url,{environment:'test',host:'127.0.0.1',port:16432,database:'aia_acreditacao_test'});
const db=createDatabase(url),row=await transaction(db,tx=>claimDelivery(tx,['BUSINESS_EMAIL'],8,randomUUID(),new Date()));if(row?.id!==process.argv[2]){await db.$disconnect();throw Error('SYNTHETIC_CLAIM_SCOPE_MISMATCH');}
process.stdout.write('CLAIM_COMMITTED\n');setInterval(()=>{},1000);
