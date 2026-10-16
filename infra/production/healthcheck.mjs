import process from 'node:process';
const origin=process.argv[2]??'http://127.0.0.1:3100';
try {const r=await globalThis.fetch(new globalThis.URL('/api/health/ready',origin),{signal:globalThis.AbortSignal.timeout(4000)});if(!r.ok)process.exitCode=1;}catch{process.exitCode=1;}
