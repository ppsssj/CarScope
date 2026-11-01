import importlib.util
from pathlib import Path
import unittest
import sys
from unittest.mock import patch
import ssl

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('readiness', Path(__file__).with_name('device-readiness.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReadinessTest(unittest.TestCase):
    def test_absent_exact_serial_never_inspects_another_device(self):
        calls = []
        def run(c):
            calls.append(c)
            return 'List of devices attached\nemulator-5556 device\n'
        r = m.collect('/sdk', 'emulator-5554', run)
        self.assertEqual(r['status'], 'BLOCKED')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][-2:], ['devices', '-l'])

    def test_wrong_avd_stops_before_shell(self):
        calls = []
        def run(c):
            calls.append(c)
            return 'emulator-5554 device' if 'devices' in c else 'Other_AVD\nOK'
        self.assertEqual(m.collect('/sdk', 'emulator-5554', run)['reason'], 'WRONG_AVD_IDENTITY')
        self.assertEqual(len(calls), 2)

    def test_exact_target_snapshot_has_only_read_commands(self):
        calls = []
        def run(c):
            calls.append(c)
            if 'devices' in c: return 'emulator-5554 device'
            if 'emu' in c: return m.AVD + '\nOK'
            if c[-1] == 'sys.boot_completed': return '1'
            if c[-1] == 'ro.build.version.release': return '14'
            if c[-1] == 'ro.build.version.sdk': return '34'
            if 'pidof' in c: return '123'
            if c[-1] == 'webviewupdate': return 'Current WebView package (name, version): (com.android.webview, 123)'
            if c[-1] == 'get-current-user': return '10'
            if 'dumpsys' in c: return 'versionName=2.3.22'
            return 'package:' + m.SERVICE
        r = m.collect('/sdk', 'emulator-5554', run)
        self.assertEqual(r['status'], 'PASS')
        self.assertTrue(all(c[1:3] == ['-s', 'emulator-5554'] for c in calls[1:]))
        self.assertFalse(any(set(c) & {'install', 'start', 'force-stop', 'kill', 'reverse', 'reboot', 'logcat'} for c in calls))

    def test_only_https_root_without_secrets_is_accepted(self):
        for value in ['http://localhost', 'https://u:p@host/', 'https://host/?token=x', 'https://host/#token', 'https://host/?', 'https://host/#', 'https://host/path', 'https://host:0', 'https://host/\n']:
            with self.assertRaises(ValueError): m.origin(value)
        self.assertEqual(m.origin('https://localhost:443/').hostname, 'localhost')

    def test_serial_and_evidence_boundaries(self):
        with self.assertRaises(ValueError): m.collect('/sdk', 'any')
        with self.assertRaises(ValueError): m.external_report(m.ROOT / 'report.json')

    def test_host_probe_is_credential_free_read_only_and_does_not_follow_redirect(self):
        with patch.object(m.http.client, 'HTTPSConnection') as factory:
            connection = factory.return_value
            response = connection.getresponse.return_value
            response.status = 401
            response.read.return_value = b'{"error":{"code":"UNAUTHORIZED"}}'
            response.getheader.return_value = 'application/json; charset=utf-8'
            self.assertEqual(m.host_probe('https://localhost/')['scope'], 'HOST_TLS_AND_API_ONLY')
            self.assertEqual(m.host_probe('https://localhost/')['status'], 'PASS')
            args, kwargs = connection.request.call_args
            self.assertEqual(args, ('GET', '/v1/sessions/00000000-0000-4000-8000-000000000000'))
            self.assertEqual(kwargs, {'headers': {'Accept': 'application/json'}})
            response.status = 302
            self.assertEqual(m.host_probe('https://localhost/')['status'], 'FAIL')
            connection.close.assert_called()

    def test_host_tls_failure_never_leaks_raw_exception(self):
        with patch.object(m.http.client, 'HTTPSConnection') as factory:
            factory.return_value.request.side_effect = ssl.SSLError('sensitive fixture exception')
            report = m.host_probe('https://localhost/')
            self.assertEqual(report['status'], 'FAIL')
            self.assertNotIn('sensitive', str(report))
            factory.return_value.close.assert_called_once()


if __name__ == '__main__': unittest.main()
