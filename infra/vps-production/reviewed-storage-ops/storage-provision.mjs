// Dependency-injected orchestration: tests exercise the exact production retry path.
export const project='aia-accreditation-production',bucket='aia-accreditation-production-photos';
export const roles=['web','worker','backup'];
export const markerKey='_production/provisioning.json';
export function check(value,code){if(!value)throw Error(code);}
export function policyFor(role){
  check(roles.includes(role),'INVALID_SCOPED_ROLE');
  return {Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['s3:GetBucketLocation','s3:GetBucketVersioning','s3:GetBucketPolicy','s3:ListBucket',...(role==='backup'?[]:['s3:ListBucketVersions'])],Resource:['arn:aws:s3:::'+bucket]},{Effect:'Allow',Action:role==='backup'?['s3:GetObject']:['s3:GetObject','s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'],Resource:['arn:aws:s3:::'+bucket+'/*']}]};
}
function normalPolicy(value){
  if(!value||value.Version!=='2012-10-17'||Object.keys(value).some(k=>!['Version','Statement','Id'].includes(k))||value.Id||!Array.isArray(value.Statement))return null;
  const list=x=>typeof x==='string'?[x]:Array.isArray(x)&&x.every(y=>typeof y==='string')?[...x].sort():null;
  const rows=value.Statement.map(s=>{
    if(!s||Object.keys(s).some(k=>!['Effect','Action','Resource','Sid'].includes(k))||s.Sid)return null;
    const Action=list(s.Action),Resource=list(s.Resource);return Action&&Resource?JSON.stringify({Effect:s.Effect,Action,Resource}):null;
  });return rows.includes(null)?null:JSON.stringify(rows.sort());
}
export function validateSnapshot(snapshot,secrets,complete=false){
  const read=name=>{const v=snapshot['iam-assets/'+name+'.json'];check(v&&typeof v==='object'&&!Array.isArray(v),'IAM_EXPORT_SCHEMA_UNSUPPORTED');return v;};
  const users=read('users'),policies=read('policies'),mappings=read('user_mappings'),groups=read('groups'),svc=read('svcaccts');
  for(const role of roles){
    const user='aia_production_'+role,policy='aia-production-'+role,current=users[user];
    check(!Object.hasOwn(svc,user),'SCOPED_IDENTITY_TYPE_CONFLICT');
    check(!Object.values(groups).some(g=>Array.isArray(g?.members)&&g.members.includes(user)),'SCOPED_GROUP_MEMBERSHIP_CONFLICT');
    if(current)check(current.secretKey===secrets[role]&&current.status==='enabled'&&!current.policy,'SCOPED_CREDENTIAL_OR_STATUS_CONFLICT');
    const attached=mappings[user]?.policy??'';
    check(attached===''||attached===policy,'SCOPED_POLICY_MAPPING_CONFLICT');
    if(Object.hasOwn(policies,policy))check(normalPolicy(policies[policy])===normalPolicy(policyFor(role)),'SCOPED_POLICY_DEFINITION_CONFLICT');
    if(complete)check(current&&Object.hasOwn(policies,policy)&&attached===policy,'SCOPED_IMPORT_OR_ATTACHMENT_NOT_VERIFIED');
  }
  return {users,policies,mappings};
}
export async function provisionStorage({s3,iam,journal,secrets,progress=()=>{}}){
  for(const role of roles)check(/^[a-f0-9]{64}$/.test(secrets[role]??''),'SCOPED_SECRET_REQUIRED');
  check(new Set(Object.values(secrets)).size===3,'DISTINCT_SCOPED_SECRETS_REQUIRED');
  await iam.verifyClient(); // Hash/version/help checks before any mutation.
  let state=validateSnapshot(await iam.snapshot(),secrets);
  progress('IAM_PREFLIGHT_PASSED');
  const buckets=await s3.listBuckets();
  check(buckets.every(name=>name===bucket)&&buckets.length<=1,'PRODUCTION_CLUSTER_BUCKET_SCOPE_MISMATCH');
  if(!buckets.length){await journal.createIntent();await s3.createBucket();}
  check(!(await s3.versioning()).Status,'UNVERSIONED_BUCKET_REQUIRED_BY_BACKUP');
  let marker;
  try{marker=await s3.getMarker();}catch(e){check(e?.name==='NoSuchKey','STORAGE_MARKER_READ_FAILED');}
  if(marker===undefined){
    check(await journal.hasIntent(),'UNMARKED_BUCKET_REQUIRES_OWN_CREATION_INTENT');
    check((await s3.listKeys()).length===0,'UNMARKED_BUCKET_NOT_EMPTY');
    // Conditional create never overwrites an existing marker (including concurrent writes).
    await s3.putMarker({project});marker=await s3.getMarker();
  }
  check(marker?.project===project,'EXISTING_BUCKET_MARKER_MISMATCH');
  progress('PRIVATE_UNVERSIONED_BUCKET_VERIFIED');
  for(const role of roles)if(!Object.hasOwn(state.policies,'aia-production-'+role))await iam.createPolicy(role,policyFor(role));
  const missing=Object.fromEntries(roles.filter(role=>!Object.hasOwn(state.users,'aia_production_'+role)).map(role=>['aia_production_'+role,{secretKey:secrets[role],status:'enabled'}]));
  if(Object.keys(missing).length)await iam.importUsers(missing);
  // mc ImportIAMV2 can report per-entity failure with exit 0. Verify server state.
  state=validateSnapshot(await iam.snapshot(),secrets);
  check(roles.every(role=>state.users['aia_production_'+role]),'SCOPED_IMPORT_NOT_VERIFIED');
  for(const role of roles)if((state.mappings['aia_production_'+role]?.policy??'')==='')await iam.attachPolicy(role);
  validateSnapshot(await iam.snapshot(),secrets,true);
  progress('IAM_SCOPED_IDENTITIES_VERIFIED');
}
