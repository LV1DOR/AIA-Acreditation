"""Operator command construction is tested without contacting Docker."""
import contextlib,importlib.util,io,json,os,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('event_probe',Path(__file__).with_name('diagnose-event.py'))
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)

class EventDiagnosticTests(unittest.TestCase):
    def test_only_isolated_maintenance_job_receives_input_without_environment_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);(state/'logs').mkdir()
            image='sha256:'+'a'*64
            receipt=json.dumps({'images':{'tools':{'id':image}}})
            (state/'images.json').write_text(receipt)
            result={'validationPassed':True,'issues':[],'database':{'readOnly':True,'matchingIdentifierExists':False}}
            child=SimpleNamespace(stdout='EVENT_DIAGNOSTIC '+json.dumps(result)+'\n',stderr='PRIVATE_STDERR',returncode=0)
            answers=['Synthetic Event','2026-11-01','2026-11-02','2026-10-20T09:00:00Z','2026-10-25T18:00:00Z']
            with patch.object(probe.d,'STATE',state),patch.object(probe.d,'local_guard'),patch.object(probe.d,'context'),patch.object(probe.d,'need'),patch.object(probe.d,'healthy'),patch.object(probe.d,'dc',return_value=json.dumps({'services':{'tools':{'image':image}}})),patch('builtins.input',side_effect=answers),patch.object(probe.subprocess,'run',return_value=child) as run,patch.dict(os.environ,{'COMPOSE_PROJECT_NAME':'unrelated','AIA_UNTRUSTED_OVERRIDE':'PRIVATE_ENV'}),contextlib.redirect_stdout(io.StringIO()) as output:
                probe.main([])
            args=run.call_args.args[0];kw=run.call_args.kwargs
            self.assertEqual(args[args.index('--project-name')+1],'aia-accreditation-staging')
            self.assertIn('--no-deps',args);self.assertIn('-T',args)
            self.assertNotIn('--rm',args);self.assertNotIn('up',args);self.assertNotIn('down',args)
            self.assertTrue(args[-1].endswith('.mts'))
            self.assertEqual(json.loads(kw['input'])['name'],'Synthetic Event')
            self.assertNotIn('COMPOSE_PROJECT_NAME',kw['env']);self.assertNotIn('AIA_UNTRUSTED_OVERRIDE',kw['env'])
            self.assertNotIn('PRIVATE',output.getvalue())
            self.assertEqual((state/'images.json').read_text(),receipt)

if __name__=='__main__':unittest.main()
