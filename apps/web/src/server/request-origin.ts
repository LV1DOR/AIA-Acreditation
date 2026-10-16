import {parseAuthEnv} from '@aia/config';

export function hasTrustedMutationOrigin(request:Pick<Request,'headers'>,environment:Record<string,string|undefined>=process.env) {
  // Behind TLS termination request.url can contain the internal HTTP origin.
  // Use explicit deployment origins, never client-controlled forwarding headers.
  try {
    const configuration=parseAuthEnv(environment),origin=request.headers.get('origin');
    return origin!==null&&[configuration.APP_ORIGIN,...configuration.AUTH_ADDITIONAL_ORIGINS].includes(origin);
  } catch {return false;}
}
