#!/usr/bin/env python3
"""Operator-only read-only event diagnostic; no service start, migration or event write."""
import argparse,json,os,subprocess
import deploy as d
from wizard_release import active

def main(argv=None):
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--form-json',action='store_true',help='Paste the five serialized form values as one JSON object')
    options=parser.parse_args(argv)
    d.local_guard();d.context();d.need('check');d.healthy(('postgres','web'))
    release=active(d.STATE,d.KIT)
    built=release['build'] if release else json.loads((d.STATE/'images.json').read_text())
    cfg=json.loads(d.dc('--profile','maintenance','config','--format','json'))
    d.require(cfg['services']['tools']['image']==built['images']['tools']['id'],'EXISTING_TOOLS_IMAGE_REQUIRED')
    print('Read-only diagnostic. Enter the values from the failed synthetic event form.')
    prompts={'name':'Synthetic event name: ','startDate':'Event start (YYYY-MM-DD): ','endDate':'Event end (YYYY-MM-DD): ',
             'onboardingOpensAt':'Onboarding opens (ISO date-time with Z or offset): ',
             'onboardingClosesAt':'Onboarding closes (ISO date-time with Z or offset): '}
    if options.form_json:
        value=json.loads(input('Paste the five-field form JSON: '))
        d.require(isinstance(value,dict) and set(value)==set(prompts) and all(isinstance(v,str) and len(v)<=2000 for v in value.values()),'INVALID_FORM_JSON')
        payload=value
    else:
        payload={k:input(prompt).strip() for k,prompt in prompts.items()}
    script=d.KIT/'diagnose-event.mts'
    args=['docker','compose','--project-name',d.PROJECT,'--env-file',str(d.STATE/'compose.env'),
          '-f',str(d.REPO/'infra/production/compose.yaml'),'-f',str(d.REPO/'infra/production/compose.staging.yaml'),'-f',str(d.KIT/'compose.vps.yaml'),
          '--profile','maintenance','run','--no-deps','--name',d.PROJECT+'-event-diagnostic-'+d.stamp(),'-T',
          '--volume',str(script)+':/tmp/aia-diagnose-event.mts:ro','-e','AIA_EVENT_DIAGNOSTIC=1',
          'tools','node','node_modules/tsx/dist/cli.mjs','/tmp/aia-diagnose-event.mts']
    env={k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','AIA_'))}
    p=subprocess.run(args,cwd=d.REPO,env=env,input=json.dumps(payload),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90)
    lines=[x.removeprefix('EVENT_DIAGNOSTIC ') for x in p.stdout.splitlines() if x.startswith('EVENT_DIAGNOSTIC ')]
    d.require(len(lines)==1,'EVENT_DIAGNOSTIC_JOB_FAILED_OUTPUT_WITHHELD')
    # Child output is schema-only: no raw error messages, input values or credentials.
    result=json.loads(lines[0]);d.put(d.STATE/'logs'/('event-diagnostic-'+d.stamp()+'.json'),result)
    print(json.dumps(result,indent=2))
    d.require(p.returncode==0 and 'diagnosticError' not in result,'EVENT_DIAGNOSTIC_FAILED')
    print('EVENT_DIAGNOSTIC_COMPLETE: no event saved; transaction was read-only; maintenance job retained.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        d.report_failure(e);raise SystemExit(1)
