import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {safeError,cliFailure,classification,createDiagnostics,createBucketProbeInput,expectFailure} from './runtime/storage-diagnostics.mjs';

test('real UUID bucket probes obey S3 limits and regional CreateBucket semantics',()=>{
 const id=randomUUID();
 assert.equal(('aia-accreditation-staging-deny-'+id).length,67);
 const input=createBucketProbeInput(id,'us-east-1');
 assert.equal(input.Bucket.length,49);
 assert.match(input.Bucket,/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
 assert.equal(Object.hasOwn(input,'CreateBucketConfiguration'),false);
 assert.notEqual(input.Bucket,createBucketProbeInput(randomUUID(),'us-east-1').Bucket);
 assert.deepEqual(createBucketProbeInput(id,'eu-central-1').CreateBucketConfiguration,{LocationConstraint:'eu-central-1'});
 for(const invalid of ['A'.repeat(36),'a'.repeat(64),'unsafe/path'])assert.throws(()=>createBucketProbeInput(invalid,'us-east-1'));
 assert.throws(()=>createBucketProbeInput(id,undefined));
});
test('HTTP 400 validation errors remain failures and buffered XML is sanitized',async()=>{
 const body='<Error><Code>InvalidBucketName</Code><Message>PRIVATE_BODY</Message><RequestId>PRIVATE_ID</RequestId></Error>';
 for(const payload of [body,Buffer.from(body)]){
  const e=Object.assign(new Error('PRIVATE_MESSAGE'),{name:'UnknownError',$metadata:{httpStatusCode:400},$response:{body:payload}});
  assert.deepEqual(safeError(e),{code:'InvalidBucketName',httpStatus:400});
  assert.equal(classification(e),2);
  await assert.rejects(expectFailure(()=>Promise.reject(e),'AccessDenied',403,'EXPECTED_ACCESS_DENIED'));
 }
 assert.equal(safeError({Code:'InvalidLocationConstraint'}).code,'InvalidLocationConstraint');
 assert.equal(safeError({$response:{body:'<Error><Code>PRIVATE_VALUE</Code></Error>'}}).code,'UnknownError');
});

test('S3 diagnostics retain code/status and exclude sensitive payloads',()=>{
 const secret='sk_test_DO_NOT_EXPOSE_LICENSE_OR_CONTENT';
 const e=Object.assign(new Error(secret),{name:'AccessDenied',$metadata:{httpStatusCode:403,requestId:secret},$response:{body:secret},accessKey:secret});
 assert.deepEqual(safeError(e),{code:'AccessDenied',httpStatus:403});
 assert(!JSON.stringify(safeError(e)).includes(secret));
 const unknown=Object.assign(new Error(secret),{name:secret,code:secret});
 assert.deepEqual(safeError(unknown),{code:'UnknownError'});
});
test('mc nested JSON extracts the S3 code without retaining CLI messages',()=>{
 const r={status:1,stdout:JSON.stringify({status:'error',error:{message:'SECRET',cause:{error:{Code:'AccessDenied',StatusCode:403,SecretKey:'SECRET'}}}}),stderr:'SECRET'};
 assert.deepEqual(safeError(cliFailure(r)),{code:'AccessDenied',httpStatus:403,exitCode:1});
 assert(!JSON.stringify(safeError(cliFailure(r))).includes('SECRET'));
});
test('403 with invalid credentials cannot pass the denied-permission test',async()=>{
 const invalid=Object.assign(new Error(),{name:'InvalidAccessKeyId',$metadata:{httpStatusCode:403}});
 await assert.rejects(expectFailure(()=>Promise.reject(invalid),'AccessDenied',403,'EXPECTED_ACCESS_DENIED'));
 const denied=Object.assign(new Error(),{name:'AccessDenied',$metadata:{httpStatusCode:403}});
 await expectFailure(()=>Promise.reject(denied),'AccessDenied',403,'EXPECTED_ACCESS_DENIED');
});
test('405 alone never becomes proof of a paid-license restriction',()=>{
 assert.equal(classification({name:'UnknownError',$metadata:{httpStatusCode:405}},4),null);
 assert.equal(classification({name:'MethodNotAllowed',$metadata:{httpStatusCode:405}}),4);
 assert.equal(classification({name:'XMinioPaidTierLicenseRequired',$metadata:{httpStatusCode:405}}),3);
 assert.equal(classification({name:'XMinioFeatureNotLicensed'}),3);
});
test('failures identify individual operations and independent probes continue',async()=>{
 const d=createDiagnostics();
 const failure=await d.run('IAM','MC_POLICY_ATTACH','web',()=>{throw Object.assign(new Error('SECRET'),{code:'AccessDenied'});});
 assert.equal(failure.ok,false);
 await d.run('OBJECTS','PUT_OBJECT','admin',()=>true);
 await d.run('OBJECTS','DELETE_OBJECT_WITH_RETURNED_VERSION_ID','web',()=>{throw Object.assign(new Error(),{name:'XMinioPaidTierLicenseRequired'});});
 assert.deepEqual(d.operations.map(x=>[x.operation,x.status,x.classification]),[['MC_POLICY_ATTACH','FAIL',1],['PUT_OBJECT','PASS',undefined],['DELETE_OBJECT_WITH_RETURNED_VERSION_ID','FAIL',3]]);
 assert(!JSON.stringify(d.operations).includes('SECRET'));
});
test('conditional PUT must reject with 412; unexpected success is API failure',async()=>{
 const d=createDiagnostics();
 await d.run('OBJECTS','CONDITIONAL_PUT_REJECTS_DUPLICATE','worker',()=>expectFailure(()=>true,'PreconditionFailed',412,'EXPECTED_PRECONDITION_FAILED'),4);
 assert.equal(d.operations[0].classification,4);
 assert.equal(d.operations[0].assertion,'EXPECTED_PRECONDITION_FAILED');
});
