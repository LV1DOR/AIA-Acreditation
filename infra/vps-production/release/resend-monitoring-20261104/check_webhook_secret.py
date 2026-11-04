"""Read-only hidden-input diagnosis. Never reads configuration or stores the input."""
import getpass,json,re,sys
sys.dont_write_bytecode=True
from webhook_configuration import check_secret

def describe(raw):
    value=raw.strip()
    report={
      'diagnostic':'WEBHOOK_SECRET_FORMAT_ONLY',
      'characters':len(value),
      'hasWhsecPrefix':value.startswith('whsec_'),
      'looksLikeApiKey':value.startswith('re_'),
      'containsWhitespace':any(c.isspace()for c in value),
      'containsControlCharacters':any(ord(c)<32 or ord(c)==127 for c in value),
      'containsNonAscii':any(ord(c)>127 for c in value),
      'wrappedInQuotes':len(value)>1 and value[0]in '\"\''and value[-1]in '\"\'',
      'includesEnvironmentAssignment':bool(re.match(r'(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=',value)),
      'configurationChanged':False,
      'valuePrintedOrStored':False,
    }
    try:check_secret(value);report['validationPassed']=True
    except RuntimeError:report['validationPassed']=False
    if report['validationPassed']:reason='FORMAT_ACCEPTED_RETRY_DEPLOY_WITH_THIS_EXACT_VALUE'
    elif not value:reason='EMPTY_INPUT_PASTE_WAS_NOT_RECEIVED'
    elif report['looksLikeApiKey']:reason='API_KEY_SUPPLIED_ENDPOINT_SIGNING_SECRET_REQUIRED'
    elif report['includesEnvironmentAssignment']:reason='COPY_VALUE_ONLY_WITHOUT_VARIABLE_NAME'
    elif report['wrappedInQuotes']:reason='COPY_VALUE_ONLY_WITHOUT_QUOTES'
    elif report['containsControlCharacters']:reason='TERMINAL_CONTROL_CHARACTERS_IN_INPUT'
    elif report['containsWhitespace']:reason='INTERNAL_WHITESPACE_IN_INPUT'
    elif report['containsNonAscii']:reason='NON_ASCII_CHARACTERS_IN_INPUT'
    elif not report['hasWhsecPrefix']:reason='ENDPOINT_SIGNING_SECRET_PREFIX_NOT_RECEIVED'
    elif not 16<=len(value[6:])<=200:reason='SIGNING_SECRET_LENGTH_REQUIRES_INSPECTION'
    else:reason='SIGNING_SECRET_BASE64_OR_DECODED_LENGTH_REQUIRES_INSPECTION'
    report['reason']=reason
    return report

def main():
    if sys.argv[1:]or not sys.stdin.isatty():raise RuntimeError('INTERACTIVE_PRIVATE_INPUT_REQUIRED')
    value=getpass.getpass('Paste the same value once (hidden; format check only): ')
    report=describe(value);del value
    print(json.dumps(report))
if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'diagnostic':'WEBHOOK_SECRET_FORMAT_ONLY','passed':False,'code':'PRIVATE_FORMAT_DIAGNOSTIC_FAILED','valuePrintedOrStored':False}));sys.exit(1)
