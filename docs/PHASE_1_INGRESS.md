# Phase 1 ingress requirements

The application must be reachable only through the intended private reverse proxy. These controls have not been installed on production. Apply them to the accreditation virtual host only; do not change Volunteers.

## Application limits

- JPEG and PNG only, actual magic and decoded format must agree with MIME.
- Original file: 8 MiB. Processed JPEG: 2 MiB. Image: at most 20 million pixels and 10,000 pixels on either axis; single frame.
- Server Action body: 9 MiB, including multipart overhead. Client crop produces JPEG, but the server independently checks every file.
- Two simultaneous image decodes per Node process, one libvips thread per decode, bounded 32 MiB image cache, immediate overload rejection and no unbounded application queue. A caller can retry. This is a process cap, so budget each replica separately.
- Public view: global 1,200/minute, source bucket 120/minute. Public submit and invitation start: global 600/minute, source bucket 60/minute. Windows are fixed, Redis checks atomic, failures closed. Valid token keys additionally allow 30 views / 10 submissions / 20 invitation starts / 5 provider tickets per 15 minutes. Invalid tokens never get a token-specific key.
- Source buckets are capped at 4,096 per endpoint scope with a 60-second expiry; global rejection happens before creation of more source keys. Tokens are hashed and expire after 15 minutes. Raw addresses/tokens are not stored as rate-limit keys.

These burst-friendly defaults allow shared company networks and near-deadline use, while the global and decoder limits constrain distinct tokens. Tune from an agreed synthetic peak workload. The benchmark in the remediation report establishes admission/recovery only, not MotoGP capacity.

## Source identification

The app ignores `Forwarded` and `X-Forwarded-For`. It accepts exactly one valid IP in `X-AIA-Client-IP` only when `X-AIA-Proxy-Secret` matches the server's `AIA_PROXY_SECRET` (at least 32 random characters). Without that authenticated header pair all requests share an `untrusted` source bucket. This is intentionally conservative for local use; configure the private ingress before external use.

Generate the secret through the deployment secret manager. Store it in the app environment and a root-readable proxy include. Never put the real value in this repository, access logs, support tickets or browser responses. Overwrite both incoming headers, do not append them. Prevent access to the app port from client networks. If another proxy/CDN precedes nginx, first configure `real_ip` with **only that provider's maintained CIDRs**, or retain `$remote_addr` and accept shared throttling; never trust every sender's forwarding headers.

## nginx example

Merge with the existing TLS/origin configuration. Names below are accreditation-specific. The upstream port shown is the existing local web port; use the reviewed private production upstream instead. Validate with `nginx -t` before a controlled reload. No reload was performed here.

In the `http` context:

```nginx
map $request_method $aia_mutation_ip {
    default "";
    POST $binary_remote_addr;
}
map $request_method $aia_mutation_global {
    default "";
    POST "aia-accreditation";
}
map $uri $aia_public_ip {
    default "";
    ~^/(pt|en)/onboarding/ $binary_remote_addr;
    /api/invitations/start $binary_remote_addr;
}
limit_req_zone $aia_mutation_ip zone=aia_mutations:10m rate=120r/m;
limit_req_zone $aia_mutation_global zone=aia_mutations_global:1m rate=600r/m;
limit_req_zone $aia_public_ip zone=aia_public:10m rate=120r/m;
limit_conn_zone $binary_remote_addr zone=aia_connections:10m;
limit_conn_zone $server_name zone=aia_total_connections:1m;
upstream aia_accreditation { server 127.0.0.1:3100; }
```

In the accreditation `server` context, alongside its existing TLS settings:

```nginx
# Protected file contains: set $aia_proxy_secret "<32+ random characters>";
include /etc/nginx/secrets/aia-accreditation-proxy.conf;
client_max_body_size 9m;
client_body_buffer_size 128k;
client_body_timeout 15s;
client_header_timeout 15s;
limit_req_status 429;
limit_conn_status 429;

location / {
    limit_req zone=aia_mutations burst=30 nodelay;
    limit_req zone=aia_mutations_global burst=30 nodelay;
    limit_req zone=aia_public burst=60 nodelay;
    limit_conn aia_connections 20;
    limit_conn aia_total_connections 100;
    proxy_request_buffering on;
    proxy_buffering off; # existing SSE needs unbuffered responses
    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 60s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-AIA-Client-IP $remote_addr;
    proxy_set_header X-AIA-Proxy-Secret $aia_proxy_secret;
    proxy_pass http://aia_accreditation;
}
```

Set tighter aggregate connections where the host's memory budget requires it; 100 is an ingress ceiling, not a certified safe worker count. Keep backing services private. Monitor body temporary storage space and memory; request buffering can spill to disk. Include SSE connections in the connection budget and verify reconnect behavior separately (F25). Keep Next's same-origin Server Action and notification CSRF checks enabled. This example is a required deployment starting point, not a tested production configuration or a complete TLS/CSP/firewall deployment.

## Deployment acceptance

Use synthetic data to verify: (1) app port unreachable externally; (2) forged headers do not change the source identity; (3) ingress emits 413 for oversized/chunked bodies before Next parsing; (4) repeated invalid and distinct-token requests get 429 with bounded Redis growth; (5) valid uploads, invitations and same-origin actions work; (6) overload rejects promptly and recovers; (7) private MinIO conditional PUT and durable cleanup work; (8) multiple web/worker replicas respect the deployment's aggregate memory budget. Repeat image/dependency checks on the actual Linux release image and record the near-deadline workload and latency/error results.
