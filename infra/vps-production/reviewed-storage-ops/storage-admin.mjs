import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {encodeUsers,decodeIam} from './iam-archive.mjs';
import {check,roles} from './storage-provision.mjs';
export const MC_SHA='83938eded435e7c28c397ece1dc590b2a79626dd9354aae2107060fec559ae2b';
export const MC_VERSION='RELEASE.2026-09-19T15-24-59Z';
export function validateClient({hash,version,importHelp,exportHelp}){
  check(hash===MC_SHA,'PINNED_MC_CHECKSUM_MISMATCH');
  check(version.split(/\s/).includes(MC_VERSION),'PINNED_MC_VERSION_MISMATCH');
  check(/\b(ALIAS|TARGET)\b/.test(importHelp)&&/zip/i.test(importHelp)&&/import/.test(importHelp),'MC_IMPORT_SYNTAX_UNSUPPORTED');
  check(exportHelp.includes('--output'),'MC_EXPORT_SYNTAX_UNSUPPORTED');
}
// All subprocess output stays in memory and is discarded. Never echo mc JSON/errors.
export async function openAdmin({rootUser,rootPassword,binary='/usr/local/bin/mc',tmp='/tmp',ca='/run/secrets/ca_cert',spawn=spawnSync,io=fs}){
  check(rootUser==='aia_production_root'&&/^[a-f0-9]{64}$/.test(rootPassword),'PRODUCTION_ROOT_IDENTITY_REQUIRED');
  check((await io.statfs(tmp)).type===0x01021994,'IAM_WORK_DIRECTORY_MUST_BE_TMPFS');
  const oldMask=process.umask(0o077),dir=await io.mkdtemp(join(tmp,'aia-iam-'));
  await io.chmod(dir,0o700);let serial=0;
  const call=(args,code)=>{
    const result=spawn(binary,args,{cwd:dir,env:{PATH:process.env.PATH,HOME:dir,TMPDIR:dir,SSL_CERT_FILE:ca,MC_HOST_production:`https://${rootUser}:${rootPassword}@minio:9000`},stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:30000,maxBuffer:256*1024});
    check(result.status===0&&!result.error,code);return result.stdout??'';
  };
  const command=(args,code)=>call(['--config-dir',join(dir,'config'),...args],code);
  const privateFile=async(name,data)=>{const path=join(dir,name);await io.writeFile(path,data,{mode:0o600,flag:'wx'});return path;};
  const roleCheck=role=>check(roles.includes(role),'INVALID_SCOPED_ROLE');
  return {
    async verifyClient(){
      const hash=createHash('sha256').update(await io.readFile(binary)).digest('hex');
      // Refuse an unexpected executable before running even its help/version command.
      check(hash===MC_SHA,'PINNED_MC_CHECKSUM_MISMATCH');
      validateClient({hash,version:call(['--version'],'MC_VERSION_CHECK_FAILED'),
        importHelp:call(['admin','cluster','iam','import','--help'],'MC_IMPORT_HELP_FAILED'),
        exportHelp:call(['admin','cluster','iam','export','--help'],'MC_EXPORT_HELP_FAILED')});
    },
    async snapshot(){
      const path=join(dir,'snapshot-'+serial+++'.zip');
      try{
        command(['admin','cluster','iam','export','--output',path,'production'],'IAM_EXPORT_FAILED');
        const stat=await io.lstat(path);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4*1024*1024,'IAM_EXPORT_FILE_INVALID');
        await io.chmod(path,0o600);return decodeIam(await io.readFile(path));
      }finally{await io.rm(path,{force:true});}
    },
    async createPolicy(role,policy){
      roleCheck(role);const path=await privateFile(role+'-policy-'+serial+++'.json',JSON.stringify(policy));
      try{command(['admin','policy','create','production','aia-production-'+role,path],'SCOPED_POLICY_CREATE_FAILED');}finally{await io.rm(path,{force:true});}
    },
    async importUsers(users){
      check(Object.keys(users).length>0&&Object.keys(users).every(u=>roles.some(r=>u==='aia_production_'+r)),'IAM_IMPORT_SCOPE_INVALID');
      const path=await privateFile('users-'+serial+++'.zip',encodeUsers(users));
      try{command(['admin','cluster','iam','import','production',path],'SCOPED_USER_IMPORT_FAILED');}finally{await io.rm(path,{force:true});}
    },
    async attachPolicy(role){roleCheck(role);command(['admin','policy','attach','production','aia-production-'+role,'--user','aia_production_'+role],'SCOPED_POLICY_ATTACH_FAILED');},
    async close(){try{await io.rm(dir,{recursive:true,force:true});}finally{process.umask(oldMask);}}
  };
}
