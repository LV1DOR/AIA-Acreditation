// Bounded ZIP/JSON codec for MinIO's iam-assets/*.json export format. Never extracts files.
import {inflateRawSync} from 'node:zlib';
const fail=()=>{throw Error('IAM_ARCHIVE_INVALID');};
const limit=4*1024*1024;
export function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function encodeUsers(users){
  const name=Buffer.from('iam-assets/users.json'),data=Buffer.from(JSON.stringify(users));
  if(data.length>limit)fail();
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
  local.writeUInt16LE(33,12);local.writeUInt32LE(crc32(data),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt16LE(33,14);central.writeUInt32LE(crc32(data),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
export function decodeIam(bytes){
  // Reject ZIP64, encryption, multi-disk, duplicates, traversal and oversized/inconsistent data.
  try{
    if(bytes.length<22||bytes.length>limit)fail();
    let end=bytes.length-22;
    while(end>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(end)!==0x06054b50)end--;
    if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||end+22+bytes.readUInt16LE(end+20)!==bytes.length)fail();
    const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
    if(count<1||count>16||bytes.readUInt16LE(end+8)!==count||offset+size!==end)fail();
    let pos=offset,total=0;const result=Object.create(null);
    for(let i=0;i<count;i++){
      if(bytes.readUInt32LE(pos)!==0x02014b50)fail();
      const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),crc=bytes.readUInt32LE(pos+16);
      const packed=bytes.readUInt32LE(pos+20),length=bytes.readUInt32LE(pos+24),nl=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),start=bytes.readUInt32LE(pos+42);
      const name=bytes.subarray(pos+46,pos+46+nl).toString('utf8');
      if(!/^iam-assets\/(policies|users|groups|svcaccts|user_mappings|group_mappings|stsuser_mappings|ldap_users|ldap_user_mappings|ldap_group_mappings)\.json$/.test(name)||Object.hasOwn(result,name)||flags&~0x808||![0,8].includes(method)||bytes.readUInt16LE(pos+34)||length>limit||packed>limit)fail();
      if(bytes.readUInt32LE(start)!==0x04034b50||bytes.readUInt16LE(start+6)!==flags||bytes.readUInt16LE(start+8)!==method)fail();
      const ln=bytes.readUInt16LE(start+26),le=bytes.readUInt16LE(start+28),dataStart=start+30+ln+le;
      if(start>=offset||dataStart+packed>offset||bytes.subarray(start+30,start+30+ln).toString('utf8')!==name)fail();
      const raw=bytes.subarray(dataStart,dataStart+packed),body=method===0?raw:inflateRawSync(raw,{maxOutputLength:limit});
      total+=body.length;if(total>limit||body.length!==length||crc32(body)!==crc)fail();
      const value=JSON.parse(body.toString('utf8'));
      if(!value||Array.isArray(value)||typeof value!=='object')fail();result[name]=value;
      // AIStor exports these additional maps. Only the empty production state is reviewed.
      if(name.startsWith('iam-assets/ldap_')&&Object.keys(value).length!==0)fail();
      pos+=46+nl+extra+comment;
    }
    if(pos!==end)fail();return result;
  }catch{fail();}
}
