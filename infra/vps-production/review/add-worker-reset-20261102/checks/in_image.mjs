import {spawnSync} from 'node:child_process';
const steps=[
 ['source-relative-imports',['/candidate/checks/source_imports.mjs','/app']],
 ['worker-artifact-guard',['/candidate/checks/worker_mail_guard.test.mjs','/app']],
 ['worker-notice-handoff',['/candidate/checks/worker_hash_contract.mjs','/app']],
 ['behaviour',['/candidate/checks/run_local.mjs','/app']],
 ['email-and-privacy-unit',['node_modules/vitest/vitest.mjs','run','--project','unit','tests/unit/invitation-auto-start.test.ts','tests/unit/shared-qr-code.test.ts','tests/unit/add-participant-modal-reset.test.ts','tests/unit/id-all-export.test.ts','tests/unit/id-all-route.test.ts','tests/unit/webook-export.test.ts','tests/unit/event-removal.test.ts','tests/unit/shared-privacy.test.ts','tests/unit/worker-esm-mail-build.test.ts','tests/unit/notification-email-fanout.test.ts','tests/unit/notification-email-scope.test.ts','tests/unit/shared-event-banner.test.ts','tests/unit/notification-presentation.test.ts','tests/unit/worker-save-privacy.test.ts','tests/unit/leader-self-profile.test.ts','tests/unit/email-templates.test.ts','tests/unit/email-branding.test.ts','tests/unit/email-transport-branding.test.ts','--maxWorkers','1','--no-file-parallelism','--no-cache']],
 ['email-types',['node_modules/typescript/bin/tsc','-p','packages/email/tsconfig.json']],
 ['domain-types',['node_modules/typescript/bin/tsc','-p','packages/domain/tsconfig.json']],
 ['web-types',['node_modules/typescript/bin/tsc','-p','apps/web/tsconfig.json','--incremental','false']],
 ['worker-types',['node_modules/typescript/bin/tsc','-p','apps/worker/tsconfig.json']],
 ['test-types',['node_modules/typescript/bin/tsc','-p','tsconfig.tests.json']],
 ['compiled-worker-mail',['/candidate/checks/worker_bundle_regression.mjs']],
];
for(const [label,args] of steps){
 console.log('CHECKING_'+label.toUpperCase().replaceAll('-','_'));
 const result=spawnSync(process.execPath,['--max-old-space-size=1024',...args],{stdio:'inherit',env:process.env,cwd:'/app',timeout:240000});
 if(result.error || result.status!==0){console.log('CHECK_FAILED_'+label.toUpperCase().replaceAll('-','_'));process.exit(1);}
}
console.log('ADD_WORKER_RESET_OFFLINE_RUNTIME_CHECKS_PASSED_NO_DATABASE_NO_EMAIL_NO_PRODUCTION_CHANGES');
