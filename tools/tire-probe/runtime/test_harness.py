import copy
import tempfile
import unittest
import zipfile
from pathlib import Path
from health import Adb, AVD, SERVICE, collect, gate_reasons, systemui_rows, process_start, systemui_identity, systemui_stable, recheck_systemui
from run import run_device, apk_check, external, driver_result
import json


INVENTORY = dict(files={'adb': True, 'emulator': True, 'api34': True})
PS = ('shell', 'ps', '-A', '-o', 'UID,PID,NAME')
USER = ('shell', 'cmd', 'activity', 'get-current-user')
TABLE = 'UID PID NAME\n10121 100 com.android.systemui\n1010121 200 com.android.systemui'


def stat(pid, start=123, state='S'):
    return f'{pid} (name (with spaces)) ' + ' '.join([state] + ['0'] * 18 + [str(start)])


class FakeAdb:
    serial = 'emulator-5554'
    sdk = Path('/not-a-real-sdk')
    binary = Path('/not-a-real-sdk/adb')
    def __init__(self, override=None): self.commands = []; self.override = override or {}
    def call(self, args, targeted=True, **_):
        self.commands.append(dict(args=args, targeted=targeted, elapsedMs=20))
        if tuple(args) in self.override:
            value = self.override[tuple(args)]
            return value() if callable(value) else value
        values = {
            ('devices', '-l'): 'List of devices attached\nemulator-5554 device product:test',
            ('get-state',): 'device', ('emu', 'avd', 'name'): AVD + '\nOK',
            ('shell', 'getprop', 'sys.boot_completed'): '1', ('shell', 'getprop', 'ro.build.version.sdk'): '34',
            ('shell', 'cat', '/sys/devices/system/cpu/online'): '0-1',
            ('shell', 'cat', '/proc/meminfo'): 'MemAvailable: 1048576 kB',
            ('shell', 'df', '-k', '/data'): 'Filesystem 1K-blocks Used Available Use% Mounted\n/data 1000000 200000 800000 20% /data',
            ('shell', 'cat', '/proc/loadavg'): '0.50 0.50 0.50 1/100 2',
            PS: TABLE,
            ('shell', 'cat', '/proc/100/stat'): stat(100), ('shell', 'cat', '/proc/200/stat'): stat(200),
            ('shell', 'cat', '/proc/100/status'): 'Uid:\t10121\t10121\t10121\t10121\n',
            ('shell', 'cat', '/proc/200/status'): 'Uid:\t1010121\t1010121\t1010121\t1010121\n',
            ('shell', 'cmd', 'package', 'list', 'packages', '-U', '--user', '0', 'com.android.systemui'): 'package:com.android.systemui.overlay uid:10001\npackage:com.android.systemui uid:10121',
            ('shell', 'cmd', 'package', 'list', 'packages', '-U', '--user', '10', 'com.android.systemui'): 'package:com.android.systemui uid:1010121',
            ('shell', 'echo', 'CARSCOPE_I2_HEALTH'): 'CARSCOPE_I2_HEALTH',
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
        self.assertEqual({0, 10}, {p['user'] for p in r['samples'][0]['systemUiProcesses']})

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
                           ('load', [0]), ('adbMs', 1001), ('adbMs', -1), ('systemUiProcesses', []), ('currentUser', '11')]:
            r = copy.deepcopy(good); r['samples'][1][key] = value; self.assertTrue(gate_reasons(r))
        r = copy.deepcopy(good); r['serviceCommands'][0]['elapsedMs'] = 2001; self.assertTrue(gate_reasons(r))

    def test_single_user_zero_and_dual_user_inventory_are_supported(self):
        adb = FakeAdb({USER: '0', PS: 'UID PID NAME\n10121 100 com.android.systemui',
                       ('shell', 'cmd', 'package', 'list', 'packages', '-e', '--user', '0', SERVICE): 'package:' + SERVICE})
        self.assertEqual('PASS', self.gate(adb)['status'])

    def test_each_required_user_must_have_exactly_one_owned_process(self):
        for table in ['UID PID NAME', 'UID PID NAME\n10121 100 com.android.systemui',
                      'UID PID NAME\n1010121 200 com.android.systemui',
                      TABLE + '\n1010121 201 com.android.systemui',
                      TABLE + '\n1110121 300 com.android.systemui',
                      TABLE.replace('1010121', '1010122')]:
            with self.subTest(table=table): self.assertEqual('BLOCKED', self.gate(FakeAdb({PS: table}))['status'])

    def test_package_uid_and_proc_uid_must_match_process_owner(self):
        for command, value in [
            (('shell', 'cmd', 'package', 'list', 'packages', '-U', '--user', '10', 'com.android.systemui'), 'package:com.android.systemui uid:10121'),
            (('shell', 'cmd', 'package', 'list', 'packages', '-U', '--user', '10', 'com.android.systemui'), 'package:com.android.systemui.extra uid:1010121'),
            (('shell', 'cat', '/proc/200/status'), 'Uid: 10121 10121 10121 10121'),
            (('shell', 'cat', '/proc/200/status'), 'Uid: 1010121 10121 1010121 1010121')]:
            with self.subTest(command=command, value=value): self.assertEqual('BLOCKED', self.gate(FakeAdb({command: value}))['status'])

    def test_pid_change_and_disappearance_during_sampling_block(self):
        for replacement in [TABLE.replace('200', '201'), 'UID PID NAME\n10121 100 com.android.systemui']:
            values = iter([TABLE, replacement])
            self.assertEqual('BLOCKED', self.gate(FakeAdb({PS: lambda: next(values)}))['status'])
        def missing(): raise RuntimeError('Process disappeared while reading stat')
        self.assertEqual('BLOCKED', self.gate(FakeAdb({('shell', 'cat', '/proc/200/stat'): missing}))['status'])

    def test_pid_starttime_uid_and_owner_changes_between_samples_block(self):
        good = self.gate()
        for key, value in [('pid', 201), ('startTicks', 124), ('uid', 1010122), ('packageUid', 1010122), ('user', 11)]:
            r = copy.deepcopy(good); r['samples'][1]['systemUiProcesses'][1][key] = value
            with self.subTest(key=key): self.assertTrue(gate_reasons(r))
        values = iter([stat(200, 123), stat(200, 123), stat(200, 124), stat(200, 124), stat(200, 124), stat(200, 124)])
        self.assertEqual('BLOCKED', self.gate(FakeAdb({('shell', 'cat', '/proc/200/stat'): lambda: next(values)}))['status'])

    def test_pid_reuse_inside_single_sample_blocks(self):
        values = iter([stat(200, 123), stat(200, 124)])
        self.assertEqual('BLOCKED', self.gate(FakeAdb({('shell', 'cat', '/proc/200/stat'): lambda: next(values)}))['status'])

    def test_runtime_recheck_uses_pass_baseline_and_identical_owner_identity(self):
        baseline = self.gate()
        self.assertEqual(systemui_identity(baseline['samples'][0], '10'), systemui_identity(recheck_systemui(FakeAdb(), baseline, '10'), '10'))
        for field, value in [('status', 'BLOCKED'), ('serial', 'emulator-9999'), ('currentUser', '11'), ('samples', [])]:
            bad = copy.deepcopy(baseline); bad[field] = value; adb = FakeAdb()
            with self.subTest(field=field), self.assertRaises(ValueError): recheck_systemui(adb, bad, '10')
            self.assertEqual([], adb.commands)
        for override in [{USER: '11'}, {('shell', 'cat', '/proc/200/stat'): stat(200, 999)},
                         {PS: TABLE.replace('200', '201'), ('shell', 'cat', '/proc/201/stat'): stat(201),
                          ('shell', 'cat', '/proc/201/status'): 'Uid: 1010121 1010121 1010121 1010121'}]:
            with self.subTest(override=override), self.assertRaises(ValueError): recheck_systemui(FakeAdb(override), baseline, '10')

    def test_zombie_dead_stopped_and_malformed_proc_stat_block(self):
        for value in [stat(200, state=s) for s in ['Z', 'X', 'x', 'T', 't', '?']] + [stat(201), stat(200, 0), 'malformed']:
            with self.subTest(value=value): self.assertEqual('BLOCKED', self.gate(FakeAdb({('shell', 'cat', '/proc/200/stat'): value}))['status'])
        self.assertEqual(('S', 123), process_start(stat(200), 200))

    def test_user_switch_within_between_or_after_samples_blocks(self):
        for sequence in [['10', '11'], ['10', '10', '11'], ['10'] * 6 + ['11']]:
            values = iter(sequence)
            adb = FakeAdb({USER: lambda: next(values), ('shell', 'cmd', 'package', 'list', 'packages', '-e', '--user', '11', SERVICE): 'package:' + SERVICE})
            with self.subTest(sequence=sequence): self.assertEqual('BLOCKED', self.gate(adb)['status'])

    def test_recent_fatal_anr_or_process_death_still_blocks_stable_pids(self):
        command = ('logcat', '-d', '-v', 'brief', '-t', '200', 'AndroidRuntime:E', 'ActivityManager:E', 'SystemUI:E', '*:S')
        for log in ['Process: com.android.systemui, PID: 200', 'ANR in com.android.systemui', 'Process com.android.systemui (pid 200) has died']:
            with self.subTest(log=log): self.assertEqual('BLOCKED', self.gate(FakeAdb({command: log}))['status'])

    def test_cpu_and_adb_budget_boundaries_are_unchanged(self):
        r = self.gate()
        for s in r['samples']: s.update(load=[2, 3, 100], adbMs=1000)
        self.assertEqual([], gate_reasons(r))
        for load in [[2.0001, 3, 0], [2, 3.0001, 0]]:
            r['samples'][0]['load'] = load
            self.assertIn('CPU/load or ADB response budget exceeded', gate_reasons(r))

    def test_slow_or_unreadable_systemui_ownership_cannot_pass(self):
        class SlowAdb(FakeAdb):
            def call(self, args, **kwargs):
                value = super().call(args, **kwargs)
                if tuple(args) == PS: self.commands[-1]['elapsedMs'] = 2001
                return value
        self.assertEqual('BLOCKED', self.gate(SlowAdb())['status'])
        def denied(): raise RuntimeError('Permission denied reading SystemUI ownership')
        self.assertEqual('BLOCKED', self.gate(FakeAdb({('shell', 'cat', '/proc/200/status'): denied}))['status'])

    def test_systemui_identity_is_order_independent_but_never_accepts_legacy_pid_only(self):
        r = self.gate(); sample = copy.deepcopy(r['samples'][0])
        sample['systemUiProcesses'].reverse()
        self.assertEqual(systemui_identity(sample, '10'), systemui_identity(r['samples'][0], '10'))
        sample['systemUiProcesses'][0]['state'] = 'R'
        self.assertEqual(systemui_identity(sample, '10'), systemui_identity(r['samples'][0], '10'))
        self.assertFalse(systemui_stable([dict(systemUiPid='100 200')] * 3, '10'))
        for text in ['UID PID NAME\nu10_a121 200 com.android.systemui', 'PID NAME\n200 com.android.systemui']:
            with self.assertRaises(ValueError): systemui_rows(text)

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
