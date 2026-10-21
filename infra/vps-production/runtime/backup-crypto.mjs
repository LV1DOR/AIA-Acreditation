// Same authenticated archive envelope as scripts/lib/backup.ts. Kit adapter, separately reviewable.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,writeFile,stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
const magic=Buffer.from('AIABKP01');
export async function encryptArchive(input,output,key,id){
  if(key.length!==32)throw Error('INVALID_ARCHIVE_KEY');
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(id));
  await writeFile(output,Buffer.concat([magic,iv]),{mode:0o600,flag:'wx'});
  await pipeline(input,c,createWriteStream(output,{flags:'a'}));await writeFile(output,c.getAuthTag(),{flag:'a'});
}
export async function decryptArchive(input,output,key,id){
  if(key.length!==32)throw Error('INVALID_ARCHIVE_KEY');
  const size=(await stat(input)).size;if(size<36)throw Error('INVALID_ARCHIVE');
  const file=await open(input,'r');let prefix,tag;
  try{prefix=Buffer.alloc(20);tag=Buffer.alloc(16);await file.read(prefix,0,20,0);await file.read(tag,0,16,size-16);}finally{await file.close();}
  if(!prefix.subarray(0,8).equals(magic))throw Error('INVALID_ARCHIVE');
  const d=createDecipheriv('aes-256-gcm',key,prefix.subarray(8));d.setAAD(Buffer.from(id));d.setAuthTag(tag);
  await pipeline(createReadStream(input,{start:20,end:size-17}),d,createWriteStream(output,{flags:'wx',mode:0o600}));
}
