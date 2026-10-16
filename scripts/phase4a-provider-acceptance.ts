import {readFile,writeFile,chmod} from 'node:fs/promises';
import {parse} from 'dotenv';
import {spawn} from 'node:child_process';
import {localStage} from './lib/phase4a-stage.ts';
if(process.env.PHASE4A_CLERK_TEST_APPROVED!=='true')throw Error('EXPLICIT_EXTERNAL_PROVIDER_APPROVAL_REQUIRED');
const s=await localStage(),local=parse(await readFile('.env')),tools=parse(await readFile(s.run+'/secrets/tools.env')),webFile=s.run+'/secrets/web.env',original=await readFile(webFile,'utf8');
if(!local.CLERK_SECRET_KEY?.startsWith('sk_test_')||!local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_'))throw Error('DEVELOPMENT_CLERK_CONFIGURATION_REQUIRED');
const browserArgs=['-f','infra/production/compose.browser.yaml'];
const web:Record<string,string>={...parse(original),NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,CLERK_SECRET_KEY:local.CLERK_SECRET_KEY,CLERK_WEBHOOK_SIGNING_SECRET:local.CLERK_WEBHOOK_SIGNING_SECRET!,AUTH_EMAIL_ENCRYPTION_KEY:tools.AUTH_EMAIL_ENCRYPTION_KEY!,DOCUMENT_ENCRYPTION_KEY:'1'.repeat(64),DOCUMENT_FINGERPRINT_KEY:'2'.repeat(64)};
const appDb=new URL(web.DATABASE_URL!);appDb.pathname='/aia_acreditacao_test';web.DATABASE_URL=appDb.toString();
const encode=(v:Record<string,string>)=>Object.entries(v).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
try{
 s.command(['up','-d','--no-deps','worker']);
 await chmod(webFile,0o600);await writeFile(webFile,encode(web));await chmod(webFile,0o444);
 s.command(['--profile','maintenance','run','--rm','--no-deps','tools','node','node_modules/tsx/dist/cli.mjs','scripts/phase4a-provider-grants.ts']);
 s.command([...browserArgs,'up','-d','postgres','minio']);s.command([...browserArgs,'up','-d','--no-deps','--force-recreate','web']);
 // The unchanged health gate must pass before exposing even loopback ingress.
 s.command([...browserArgs,'up','-d','ingress']);
 const testDb=new URL(tools.AIA_CLUSTER_DATABASE_URL!);testDb.hostname='127.0.0.1';testDb.port='16434';testDb.pathname='/aia_acreditacao_test';testDb.searchParams.set('sslrootcert',s.run.replaceAll('\\','/')+'/tls/ca.crt');
 const env={...process.env,...web,NODE_EXTRA_CA_CERTS:s.run+'/tls/ca.crt',TEST_DATABASE_URL:testDb.toString(),MINIO_ACCESS_KEY:tools.MINIO_ACCESS_KEY,MINIO_SECRET_KEY:tools.MINIO_SECRET_KEY,MINIO_ENDPOINT:'https://127.0.0.1:19010',PLAYWRIGHT_RELEASE_ORIGIN:'https://localhost:18443',PHASE4A_CLERK_TEST_APPROVED:'true'};
 if(!process.argv.includes('--http-only'))await new Promise<void>((ok,no)=>{const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.release.config.ts'],{env,stdio:'inherit',windowsHide:true});child.once('error',no);child.once('exit',code=>code===0?ok():no(Error('LINUX_BROWSER_ACCEPTANCE_FAILED')));});
 // Exercise the stage's own random-key database through the same candidate after
 // browser fixtures finish. This uses the approved development provider only.
 const stageWeb={...parse(original),NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,CLERK_SECRET_KEY:local.CLERK_SECRET_KEY,CLERK_WEBHOOK_SIGNING_SECRET:local.CLERK_WEBHOOK_SIGNING_SECRET!,AUTH_EMAIL_ENCRYPTION_KEY:tools.AUTH_EMAIL_ENCRYPTION_KEY!};
 await chmod(webFile,0o600);await writeFile(webFile,encode(stageWeb));await chmod(webFile,0o444);s.command([...browserArgs,'up','-d','--no-deps','--force-recreate','web']);s.command([...browserArgs,'up','-d','ingress']);
 s.command(['--profile','maintenance','run','--rm','--no-deps','tools','node','node_modules/tsx/dist/cli.mjs','scripts/phase4a-linux-acceptance.ts']);
}finally{await chmod(webFile,0o600);await writeFile(webFile,original);await chmod(webFile,0o444);s.command(['stop','ingress']);s.command(['up','-d','--no-deps','--force-recreate','web']);s.command(['up','-d','postgres','minio']);}
