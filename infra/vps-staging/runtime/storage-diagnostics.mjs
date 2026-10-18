// Deliberately excludes messages, requests, keys, bodies, IDs, license and CLI text.
export const SAFE_CODES = new Set([
 'AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','InvalidArgument','InvalidRequest',
 'InvalidBucketName','InvalidLocationConstraint','IllegalLocationConstraintException','InvalidRegion','MalformedXML',
 'MalformedPolicy','NoSuchPolicy','NoSuchUser','XMinioAdminNoSuchUser','XMinioAdminNoSuchPolicy',
 'XMinioAdminPolicyChangeAlreadyApplied','EntityAlreadyExists','PolicyAlreadyExists',
 'NotImplemented','MethodNotAllowed','NoSuchBucketPolicy','NoSuchKey','NotFound','NoSuchBucket',
 'PreconditionFailed','ConditionalRequestConflict','XMinioPaidTierLicenseRequired','XMinioFeatureNotLicensed',
 'SlowDown','InternalError','ServiceUnavailable','ExpiredToken','InvalidToken','RequestTimeTooSkewed',
 'AuthorizationHeaderMalformed','InvalidSecurity','ENOENT','ETIMEDOUT','ECONNREFUSED','ENOTFOUND',
 'ECONNRESET','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN',
 'UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','AbortError','TimeoutError',
 'AssertionFailed','CLIExitFailure','UnknownError','TypeError','ReferenceError','SyntaxError'
]);
export const ASSERTIONS = new Set(['TARGET_MISMATCH','BUCKET_SCOPE_MISMATCH','MARKER_MISMATCH',
 'VERSIONING_MUST_BE_DISABLED','BUCKET_POLICY_MUST_BE_PRIVATE','CREDENTIAL_CONFIG_MISMATCH',
 'EXPECTED_ACCESS_DENIED','EXPECTED_PRECONDITION_FAILED','CONTENT_MISMATCH','EXPECTED_OBJECT_LIST_ENTRY',
 'EXPECTED_ABSENCE','MISSING_VERSION_ENTRY','STORAGE_COPY_REMAINS','INVALID_PROBE_BUCKET_NAME','INVALID_PROBE_REGION']);
export function check(value, assertion) {
 if(!value){const e=new Error();e.code='AssertionFailed';e.assertion=ASSERTIONS.has(assertion)?assertion:'TARGET_MISMATCH';throw e;}
}
export function safeError(error) {
 const e=error??{};
 // SDKs may expose S3 Code with either case. Only inspect already-buffered XML;
 // never consume response streams or return the body/message/request identifiers.
 const body=e.$response?.body;
 const xml=typeof body==='string'?body.slice(0,65536):Buffer.isBuffer(body)?body.subarray(0,65536).toString('utf8'):'';
 const xmlCode=xml.match(/<Code>\s*([A-Za-z]+)\s*<\/Code>/)?.[1];
 const candidates=[e.code,e.Code,e.name,e.cause?.code,e.cause?.Code,xmlCode];
 const code=candidates.find(x=>x!=='UnknownError'&&SAFE_CODES.has(x))??(e.message==='STORAGE_COPY_REMAINS'?'AssertionFailed':'UnknownError');
 const out={code};
 const status=e.$metadata?.httpStatusCode??e.httpStatus;
 if(Number.isInteger(status)&&status>=100&&status<=599)out.httpStatus=status;
 if(Number.isInteger(e.exitCode))out.exitCode=e.exitCode;
 if(ASSERTIONS.has(e.assertion))out.assertion=e.assertion;
 if(e.message==='STORAGE_COPY_REMAINS')out.assertion='STORAGE_COPY_REMAINS';
 return out;
}
export function cliFailure(result) {
 // --json error responses can nest cause.error.Code. Never return raw objects/text.
 let found={};
 function inspect(value){
  if(!value||typeof value!=='object')return;
  for(const [key,v]of Object.entries(value)){
   if(['Code','code'].includes(key)&&SAFE_CODES.has(v))found.code=v;
   if(['statusCode','StatusCode','httpStatusCode'].includes(key)&&Number.isInteger(v)&&v>=100&&v<=599)found.httpStatus=v;
   if(v&&typeof v==='object')inspect(v);
  }
 }
 for(const output of [result.stdout,result.stderr])for(const line of (output??'').split('\n')){
  try{inspect(JSON.parse(line));}catch{/* No free-text parsing or logging. */}
 }
 const e=new Error();e.code=found.code??(SAFE_CODES.has(result.error?.code)?result.error.code:'CLIExitFailure');
 e.httpStatus=found.httpStatus;if(Number.isInteger(result.status))e.exitCode=result.status;
 return e;
}
export function classification(error, fallback=null){
 if(['TypeError','ReferenceError','SyntaxError'].includes(error?.name))return 2;
 const {code}=safeError(error);
 if(code==='InvalidBucketName')return 2;
 if(['InvalidLocationConstraint','IllegalLocationConstraintException','InvalidRegion'].includes(code))return 1;
 if(['XMinioPaidTierLicenseRequired','XMinioFeatureNotLicensed'].includes(code))return 3;
 if(['NotImplemented','MethodNotAllowed'].includes(code))return 4;
 if(['AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','ExpiredToken','InvalidToken',
 'RequestTimeTooSkewed','AuthorizationHeaderMalformed','InvalidSecurity','MalformedPolicy',
 'NoSuchPolicy','NoSuchUser','XMinioAdminNoSuchUser','XMinioAdminNoSuchPolicy','ENOENT','ETIMEDOUT',
 'ECONNREFUSED','ENOTFOUND','ECONNRESET','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT',
 'SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code))return 1;
 return code==='AssertionFailed'?fallback:null;
}
export function createDiagnostics(){
 const operations=[];
 return {operations,
  async run(stage,operation,role,fn,fallback=null){
   try{const value=await fn();operations.push({stage,operation,role,status:'PASS'});return {ok:true,value};}
   catch(error){operations.push({stage,operation,role,status:'FAIL',...safeError(error),classification:classification(error,fallback)});return {ok:false};}
  },
  blocked(stage,operation,role){operations.push({stage,operation,role,status:'BLOCKED'});}
 };
}
export async function expectFailure(fn,code,status,assertion){
 try{await fn();}catch(error){const safe=safeError(error);if((Array.isArray(code)?code.includes(safe.code):safe.code===code)&&safe.httpStatus===status)return;throw error;}
 check(false,assertion);
}
export function createBucketProbeInput(uuid,region){
 const name='aia-stg-deny-'+uuid;
 check(typeof uuid==='string'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name),'INVALID_PROBE_BUCKET_NAME');
 check(typeof region==='string'&&/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region),'INVALID_PROBE_REGION');
 const input={Bucket:name};
 if(region!=='us-east-1')input.CreateBucketConfiguration={LocationConstraint:region};
 return input;
}
