import {localStage} from './lib/phase4a-stage.ts';
import {readFile,writeFile,chmod} from 'node:fs/promises';
const s=await localStage(),action=process.argv[2];
const tool=(script:string,args:string[]=[])=>s.command(['--profile','maintenance','run','--rm','--no-deps','tools','node','node_modules/tsx/dist/cli.mjs',script,...args]);
switch(action){
 case 'images': {const m=JSON.parse(await readFile('.impeccable/review/phase4a/materials.json','utf8'));let text=await readFile(s.composeEnv,'utf8');for(const role of ['web','worker','tools'])text=text.replace(new RegExp('^AIA_'+role.toUpperCase()+'_IMAGE=.*$','m'),'AIA_'+role.toUpperCase()+'_IMAGE="aia-accreditation-phase4a/'+role+':'+m.sourceSha.slice(0,12)+'"');await chmod(s.composeEnv,0o600);await writeFile(s.composeEnv,text);await writeFile(s.run+'/release-manifest.json',JSON.stringify({environment:'staging',project:s.project,composeEnv:s.composeEnv,sourceSha:m.sourceSha,target:{environment:'staging',host:'postgres',port:5432,database:'aia_phase4a_stage'},synthetic:true},null,2));break;}
 case 'config':s.command(['config','--quiet']);break;
 case 'infra':s.command(['up','-d','postgres','redis','minio','mailpit']);break;
 case 'bootstrap':tool('scripts/phase4a-bootstrap.ts');break;
 case 'migrate':tool('scripts/migrate.ts');break;
 case 'grants':tool('scripts/phase4a-bootstrap.ts',['grants']);break;
 case 'app':s.command(['up','-d','web','worker','ingress']);break;
 case 'status':s.command(['ps','-a']);break;
 case 'stop':s.command(['stop']);break;
 case 'test':s.command(['--profile','maintenance','run','--rm','--no-deps','-e','AIA_RUNTIME_ENV_FILE=/run/secrets/test_env','tools','node','node_modules/tsx/dist/cli.mjs','scripts/phase4a-linux-tests.ts']);break;
 case 'acceptance':tool('scripts/phase4a-linux-acceptance.ts');break;
 case 'migrations':tool('scripts/phase4a-migration-rehearsal.ts');break;
 case 'restore':tool('scripts/phase4a-restore-rehearsal.ts');break;
 default:throw Error('EXPECTED_config_infra_bootstrap_migrate_grants_app_status_test_acceptance_migrations_restore_stop');
}
