import copy
import tempfile
import unittest
import zipfile
from pathlib import Path
from health import Adb, AVD, SERVICE, collect, gate_reasons
from run import run_device, apk_check, external, driver_result
import json


INVENTORY = dict(files={'adb': True, 'emulator': True, 'api34': True})


class FakeAdb:
    serial = 'emulator-5554'
    sdk = Path('/not-a-real-sdk')
    binary = Path('/not-a-real-sdk/adb')
    def __init__(self, override=None): self.commands = []; self.override = override or {}
    def call(self, args, targeted=True, **_):
        self.commands.append(dict(args=args, targeted=targeted, elapsedMs=20))
        if tuple(args) in self.override: return self.override[tuple(args)]
        values = {
            ('devices', '-l'): 'List of devices attached\nemulator-5554 device product:test',
            ('get-state',): 'device', ('emu', 'avd', 'name'): AVD + '\nOK',
            ('shell', 'getprop', 'sys.boot_completed'): '1', ('shell', 'getprop', 'ro.build.version.sdk'): '34',
            ('shell', 'cat', '/sys/devices/system/cpu/online'): '0-1',
            ('shell', 'cat', '/proc/meminfo'): 'MemAvailable: 1048576 kB',
            ('shell', 'df', '-k', '/data'): 'Filesystem 1K-blocks Used Available Use% Mounted\n/data 1000000 200000 800000 20% /data',
            ('shell', 'cat', '/proc/loadavg'): '0.50 0.50 0.50 1/100 2',
            ('shell', 'pidof', 'com.android.systemui'): '100', ('shell', 'echo', 'CARSCOPE_I2_HEALTH'): 'CARSCOPE_I2_HEALTH',
            ('shell', 'cmd', 'activity', 'get-current-user'): '10',
            ('shell', 'dumpsys', 'webviewupdate'): 'Current WebView package (name, version): (com.android.webview, 130.0)',
            ('shell', 'dumpsys', 'package', SERVICE): 'versionName=2.3.22',
            ('shell', 'cmd', 'package', 'list', 'packages', '-e', '--user', '10', SERVICE): 'package:' + SERVICE,
            ('logcat', '-d', '-v', 'brief', '-t', '200', 'AndroidRuntime:E', 'ActivityManager:E', 'SystemUI:E', '*:S'): '',
        }
        if tuple(args) not in values: raise AssertionError('Unexpected command: ' + repr(args))
        return values[tuple(args)]


class HarnessTest(unittest.TestCase):
    def gate(self, adb=None): return collect(adb or FakeAdb(), inventory=copy.deepcopy(INVENTORY), sleep=lambda _: None)

    def test_healthy_fixture_passes_without_claiming_sdk_capability(self):
        r = self.gate(); self.assertEqual('PASS', r['status']); self.assertEqual([], r['reasons'])
        self.assertEqual('2.3.22', r['serviceVersion']); self.assertNotIn('capability', r)

    def test_missing_target_never_uses_other_connected_device(self):
        adb = FakeAdb({('devices', '-l'): 'emulator-9999 device\nphysical-phone device'})
        r = self.gate(adb); self.assertEqual('BLOCKED', r['status'])
        self.assertEqual([['devices', '-l']], [c['args'] for c in adb.commands])
        before = len(adb.commands)
        result = run_device(adb, r, Path('/unused'), '/unused.apk', '/unused.glb', True)
        self.assertEqual('BLOCKED', result['status']); self.assertEqual(before, len(adb.commands))
        self.assertTrue(all(c['status'] == 'BLOCKED' for c in result['checks'].values()))

    def test_wrong_avd_stops_before_guest_shell(self):
        adb = FakeAdb({('emu', 'avd', 'name'): 'SomeOtherAvd\nOK'})
        self.assertEqual('BLOCKED', self.gate(adb)['status'])
        self.assertFalse(any(c['args'][0] == 'shell' for c in adb.commands))

    def test_missing_host_sdk_stops_before_adb(self):
        adb = FakeAdb(); inventory = copy.deepcopy(INVENTORY); inventory['files']['adb'] = False
        self.assertEqual('BLOCKED', collect(adb, inventory=inventory)['status']); self.assertEqual([], adb.commands)

    def test_every_resource_service_and_response_budget_is_enforced(self):
        good = self.gate()
        for key, value in [('boot', '0'), ('api', '33'), ('memAvailableKiB', 524287), ('storageAvailableKiB', 262143),
                           ('webview', None), ('serviceEnabled', ''), ('serviceVersion', None), ('systemUiFatal', True), ('cpuCount', 0)]:
            r = copy.deepcopy(good); r[key] = value
            with self.subTest(key=key): self.assertTrue(gate_reasons(r))
        for key, value in [('load', [2.01, 1, 1]), ('load', [1, 3.01, 1]), ('load', [float('nan'), 0, 0]),
                           ('load', [0]), ('adbMs', 1001), ('adbMs', -1), ('systemUiPid', '200'), ('systemUiPid', '100 200')]:
            r = copy.deepcopy(good); r['samples'][1][key] = value; self.assertTrue(gate_reasons(r))
        r = copy.deepcopy(good); r['serviceCommands'][0]['elapsedMs'] = 2001; self.assertTrue(gate_reasons(r))

    def test_existing_carscope_process_is_not_installed_over_or_interrupted(self):
        adb = FakeAdb({('shell', 'sh', '-c', 'pidof io.carscope.app || true'): '777'})
        gate = self.gate(adb); adb.commands.clear()
        result = run_device(adb, gate, Path('/unused'), '/unused.apk', '/unused.glb', True)
        self.assertEqual('BLOCKED', result['status'])
        self.assertFalse(any(c['args'][0] in ['install', 'push', 'forward', 'logcat'] for c in adb.commands))
        self.assertFalse(any('start' in c['args'] for c in adb.commands))

    def test_device_identity_race_aborts_before_mutation(self):
        adb = FakeAdb(); gate = self.gate(adb)
        adb.override[('emu', 'avd', 'name')] = 'Other\nOK'; adb.commands.clear()
        result = run_device(adb, gate, Path('/unused'), '/unused.apk', '/unused.glb', True)
        self.assertEqual('BLOCKED', result['status'])
        self.assertEqual([['get-state'], ['emu', 'avd', 'name']], [c['args'] for c in adb.commands])

    def test_physical_serial_repo_output_and_missing_apk_are_rejected(self):
        with self.assertRaises(ValueError): Adb('/sdk', 'physical-phone')
        with self.assertRaises(ValueError): external(Path(__file__).resolve().parent)
        with tempfile.TemporaryDirectory() as d: self.assertEqual('BLOCKED', apk_check(Path(d) / 'missing.apk')['status'])

    def test_offline_apk_assets_and_glb_guard_does_not_claim_a_device_result(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'synthetic.zip'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('classes.dex', b'Lio/carscope/app/lab/InspectionActivity; Lio/carscope/app/tire/TireUiChannel;')
                for name in ['inspect.js', 'tire-status.mjs', 'android-inspect-shell.js', 'csp.txt']: z.writestr('assets/inspection/' + name, '')
            self.assertEqual('PASS', apk_check(p)['status'])
            with zipfile.ZipFile(p, 'a') as z: z.writestr('assets/forbidden.glb', b'glTF')
            self.assertEqual('BLOCKED', apk_check(p)['status'])
            p.write_text('not a zip'); self.assertEqual('BLOCKED', apk_check(p)['status'])

    def test_stale_or_contradictory_driver_results_never_become_runtime_pass(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'result.json'; result = dict(runId='new', status='PASS', checks={'model': {'status': 'PASS'}})
            p.write_text(json.dumps(result))
            self.assertEqual('PASS', driver_result(p, 'new', 0)['status'])
            with self.assertRaises(RuntimeError): driver_result(p, 'old', 0)
            with self.assertRaises(RuntimeError): driver_result(p, 'new', 1)
            result['checks']['model']['status'] = 'ASSUMED'; p.write_text(json.dumps(result))
            with self.assertRaises(RuntimeError): driver_result(p, 'new', 0)


if __name__ == '__main__': unittest.main()
