import {expect,it} from 'vitest';
import {hasTrustedMutationOrigin} from '../../apps/web/src/server/request-origin.ts';
const environment={APP_ORIGIN:'https://accreditation.example.invalid'};
const request=(origin?:string,extra:Record<string,string>={})=>new Request('http://web:3100/api/notifications/read',{headers:{...extra,...(origin===undefined?{}:{origin})}});
it('accepts the configured HTTPS origin when the route URL uses the internal HTTP origin',()=>{expect(hasTrustedMutationOrigin(request(environment.APP_ORIGIN),environment)).toBe(true);});
it('rejects an attacker origin despite forged host and forwarding headers',()=>{expect(hasTrustedMutationOrigin(request('https://attacker.invalid',{host:'attacker.invalid','x-forwarded-host':'attacker.invalid','x-forwarded-proto':'https'}),environment)).toBe(false);});
it('requires an exact origin and rejects missing, null, suffix and path variants',()=>{for(const origin of [undefined,'null',environment.APP_ORIGIN+'.attacker.invalid',environment.APP_ORIGIN+'/',environment.APP_ORIGIN+'/path'])expect(hasTrustedMutationOrigin(request(origin),environment)).toBe(false);});
it('accepts an additional origin only when explicitly configured',()=>{const origin='https://preview.example.invalid';expect(hasTrustedMutationOrigin(request(origin),environment)).toBe(false);expect(hasTrustedMutationOrigin(request(origin),{...environment,AUTH_ADDITIONAL_ORIGINS:origin})).toBe(true);});
it('fails closed when deployment origin configuration is invalid',()=>{expect(hasTrustedMutationOrigin(request('https://attacker.invalid'),{APP_ORIGIN:'https://attacker.invalid/path'})).toBe(false);});
