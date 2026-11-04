"""Prepare only the two new web keys; values never enter argv, reports or logs."""
import base64,getpass,re,sys

def check_secret(value):
    if not re.fullmatch(r'whsec_[A-Za-z0-9+/=_-]{16,200}',value):raise RuntimeError('VALID_RESEND_WEBHOOK_SIGNING_SECRET_REQUIRED')
    try:raw=base64.b64decode(value[6:]+'='*((-len(value[6:]))%4),altchars=b'-_',validate=True)
    except ValueError:raise RuntimeError('VALID_RESEND_WEBHOOK_SIGNING_SECRET_REQUIRED')from None
    if len(raw)<16:raise RuntimeError('VALID_RESEND_WEBHOOK_SIGNING_SECRET_REQUIRED')
    return value

def prepare(content,ask=getpass.getpass):
    text=content.decode();keys={}
    for line in text.splitlines():
        if not line.strip()or line.lstrip().startswith('#')or '='not in line:continue
        name,value=line.split('=',1)
        if name in ['RESEND_WEBHOOK_SECRET','RESEND_MONITOR_FROM_DOMAINS']:
            if name in keys:raise RuntimeError('DUPLICATE_WEBHOOK_CONFIGURATION_REFUSED')
            keys[name]=value.strip().strip('"').strip("'")
    if 'RESEND_MONITOR_FROM_DOMAINS'in keys and keys['RESEND_MONITOR_FROM_DOMAINS']!='notify.joinaia.pt':raise RuntimeError('EXISTING_MONITOR_DOMAIN_SCOPE_REQUIRES_REVIEW')
    additions=[]
    if 'RESEND_WEBHOOK_SECRET'in keys:check_secret(keys['RESEND_WEBHOOK_SECRET'])
    else:
        if ask is getpass.getpass and not sys.stdin.isatty():raise RuntimeError('INTERACTIVE_PRIVATE_SECRET_PROMPT_REQUIRED')
        first=ask('Resend endpoint signing secret (whsec_, hidden; never the API key): ').strip()
        second=ask('Enter the same webhook signing secret again (hidden): ').strip()
        if first!=second:raise RuntimeError('WEBHOOK_SIGNING_SECRETS_DO_NOT_MATCH')
        additions.append('RESEND_WEBHOOK_SECRET="'+check_secret(first)+'"')
    if 'RESEND_MONITOR_FROM_DOMAINS'not in keys:additions.append('RESEND_MONITOR_FROM_DOMAINS="notify.joinaia.pt"')
    if not additions:return content
    return content+(b''if not content or content.endswith(b'\n')else b'\n')+('\n'.join(additions)+'\n').encode()
