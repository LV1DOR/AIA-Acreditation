"""Diagnostics identify paste failures without printing values or changing validation."""
import base64,importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('secret_diagnostic',Path(__file__).with_name('check_webhook_secret.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class SecretDiagnostic(unittest.TestCase):
 def test_valid_secret_is_accepted_but_never_in_report(self):
  value='whsec_'+base64.b64encode(b'SYNTHETIC-ONLY-KEY'*2).decode();report=d.describe(value)
  self.assertTrue(report['validationPassed']);self.assertNotIn(value,json.dumps(report));self.assertFalse(report['configurationChanged'])
 def test_invalid_input_reports_only_format_and_does_not_weaken_validator(self):
  good='whsec_'+base64.b64encode(b'SYNTHETIC-ONLY-KEY'*2).decode()
  for value,reason in [('','EMPTY_INPUT_PASTE_WAS_NOT_RECEIVED'),('re_synthetic_value','API_KEY_SUPPLIED_ENDPOINT_SIGNING_SECRET_REQUIRED'),('RESEND_WEBHOOK_SECRET='+good,'COPY_VALUE_ONLY_WITHOUT_VARIABLE_NAME'),('"'+good+'"','COPY_VALUE_ONLY_WITHOUT_QUOTES'),(good+'\x1b','TERMINAL_CONTROL_CHARACTERS_IN_INPUT'),('whsec_abc def','INTERNAL_WHITESPACE_IN_INPUT'),('whsec_abc\u200bdef','NON_ASCII_CHARACTERS_IN_INPUT')]:
   with self.subTest(reason=reason):
    report=d.describe(value);self.assertFalse(report['validationPassed']);self.assertEqual(report['reason'],reason)
    if value:self.assertNotIn(value,json.dumps(report))
if __name__=='__main__':unittest.main()
