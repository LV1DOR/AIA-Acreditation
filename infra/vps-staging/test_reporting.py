"""Failure diagnostics must retain locations while excluding sensitive values."""
import contextlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import deploy as d

class ReportingTests(unittest.TestCase):
    def test_storage_matrix_renderer_filters_raw_payloads_and_unknown_codes(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(d,'STATE',Path(tmp)):
            folder=Path(tmp)/'backups';folder.mkdir()
            (folder/'storage-check.json').write_text(json.dumps({'operations':[
                {'stage':'OBJECTS','operation':'GET_BUCKET_VERSIONING','role':'web','status':'FAIL','code':'AccessDenied','httpStatus':403,'classification':1,'message':'PRIVATE_PAYLOAD','accessKey':'PRIVATE_PAYLOAD'},
                {'stage':'OBJECTS','operation':'PUT_OBJECT','role':'worker','status':'FAIL','code':'PRIVATE_PAYLOAD','httpStatus':403},
                {'stage':'OBJECTS','operation':'CONDITIONAL_PUT_REJECTS_DUPLICATE','role':'web','status':'FAIL','code':'AssertionFailed','assertion':'EXPECTED_PRECONDITION_FAILED','classification':4},
                {'stage':'OBJECTS','operation':'DELETE_OBJECT_WITH_RETURNED_VERSION_ID','role':'web','status':'PASS','returnedVersionIdUsed':True,'versionIdKind':'null-version','versionId':'PRIVATE_PAYLOAD'},
                {'stage':'OBJECTS','operation':'DELETE_OBJECT_WITH_RETURNED_VERSION_ID','role':'worker','status':'PASS','versionIdKind':'PRIVATE_PAYLOAD'}]}))
            console=io.StringIO()
            with contextlib.redirect_stdout(console):d.storage_report()
            text=console.getvalue()
            self.assertNotIn('PRIVATE_PAYLOAD',text)
            self.assertIn('AccessDenied',text);self.assertIn('EXPECTED_PRECONDITION_FAILED',text)
            self.assertIn('"returnedVersionIdUsed":true',text);self.assertIn('"versionIdKind":"null-version"',text)

    def test_private_traceback_retains_location_without_exception_text_or_locals(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(d,'STATE',Path(tmp)):
            secret='sk_test_PRIVATE_FIXTURE_AND_LICENSE_CONTENTS'
            console=io.StringIO()
            try:
                raise TypeError(secret)
            except TypeError as error:
                with contextlib.redirect_stdout(console):path=d.report_failure(error)
            self.assertIsNotNone(path)
            text=path.read_text();report=json.loads(text)
            self.assertNotIn(secret,text+console.getvalue())
            self.assertEqual(report['exceptionType'],'TypeError')
            self.assertTrue(report['traceback'][0]['line']>0)
            self.assertIn('test_reporting.py',report['traceback'][0]['file'])
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual(path.parent.stat().st_mode&0o777,0o700)

    def test_known_guard_code_stays_useful(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(d,'STATE',Path(tmp)):
            with contextlib.redirect_stdout(io.StringIO()):path=d.report_failure(RuntimeError('APP_ISOLATION_REQUIRED'))
            self.assertEqual(json.loads(path.read_text())['code'],'APP_ISOLATION_REQUIRED')

if __name__=='__main__':unittest.main()
