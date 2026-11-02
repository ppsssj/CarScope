"""Read-only, exact-target Android health gate. Never creates, starts or repairs an emulator."""
import os
import math
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone

SERIAL = 'emulator-5554'
AVD = 'CarScope_Pleos_API34'
SERVICE = 'ai.pleos.playground.service.vehicle'
SYSTEM_UI = 'com.android.systemui'
USER_OFFSET = 100000  # AOSP AID_USER_OFFSET; verify package-manager UID as well as the ps owner.


def systemui_rows(text):
    lines = text.splitlines()
    if not lines or lines[0].split() != ['UID', 'PID', 'NAME']:
        raise ValueError('Unrecognized SystemUI process table')
    rows = []
    for line in lines[1:]:
        fields = line.split()
        if fields and fields[-1] == SYSTEM_UI:
            if len(fields) != 3 or not all(re.fullmatch(r'[0-9]+', n) for n in fields[:2]):
                raise ValueError('Invalid SystemUI UID/PID')
            rows.append((int(fields[0]), int(fields[1])))
    return sorted(rows)


def process_start(stat, pid):
    # comm may contain spaces and parentheses; starttime is field 22, state is field 3.
    left, right = stat.find('('), stat.rfind(')')
    if left < 1 or right <= left or stat[:left].strip() != str(pid):
        raise ValueError('Invalid SystemUI stat identity')
    fields = stat[right + 1:].split()
    if len(fields) < 20 or fields[0] not in ('R', 'S', 'D', 'I') or not re.fullmatch(r'[0-9]+', fields[19]) or int(fields[19]) <= 0:
        raise ValueError('SystemUI stopped, exited or has invalid start time')
    return fields[0], int(fields[19])


def systemui_sample(adb):
    def query(args):
        value = adb.call(args, timeout=2)
        if adb.commands[-1].get('elapsedMs', 0) > 2000:
            raise RuntimeError('SystemUI ownership query exceeds 2s')
        return value
    user = query(['shell', 'cmd', 'activity', 'get-current-user'])
    if not re.fullmatch(r'[0-9]+', user): raise ValueError('Invalid current Android user')
    expected = {0, int(user)}
    command = ['shell', 'ps', '-A', '-o', 'UID,PID,NAME']
    rows = systemui_rows(query(command))
    if len(rows) != len(expected) or {uid // USER_OFFSET for uid, _ in rows} != expected:
        raise ValueError('Expected one SystemUI for user 0 and current user; missing/duplicate/unexpected owner')
    processes = []
    for uid, pid in rows:
        owner = uid // USER_OFFSET
        package = query(['shell', 'cmd', 'package', 'list', 'packages', '-U', '--user', str(owner), SYSTEM_UI])
        package_uids = re.findall(r'^package:com\.android\.systemui uid:([0-9]+)\s*$', package, re.M)
        if package_uids != [str(uid)]: raise ValueError('SystemUI process owner differs from package UID')
        state, start = process_start(query(['shell', 'cat', f'/proc/{pid}/stat']), pid)
        status = query(['shell', 'cat', f'/proc/{pid}/status'])
        found = re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$', status, re.M)
        if not found or any(int(n) != uid for n in found.groups()): raise ValueError('SystemUI /proc owner differs from ps/package')
        processes.append(dict(user=owner, uid=uid, packageUid=int(package_uids[0]), pid=pid, startTicks=start, state=state))
    if systemui_rows(query(command)) != rows: raise ValueError('SystemUI changed during sample')
    for p in processes:
        _, start = process_start(query(['shell', 'cat', f"/proc/{p['pid']}/stat"]), p['pid'])
        if start != p['startTicks']: raise ValueError('SystemUI PID reused during sample')
    after = query(['shell', 'cmd', 'activity', 'get-current-user'])
    if after != user: raise ValueError('Android user changed during SystemUI sample')
    return dict(currentUser=user, currentUserAfter=after, systemUiProcesses=processes)


def systemui_identity(sample, user):
    """Validated owner/PID/starttime identity; state may vary between healthy R/S samples."""
    if not re.fullmatch(r'[0-9]+', str(user)) or sample.get('currentUser') != user or sample.get('currentUserAfter') != user:
        raise ValueError('Android user changed or was not observed')
    expected = {0, int(user)}
    processes = sample.get('systemUiProcesses')
    if not isinstance(processes, list) or len(processes) != len(expected): raise ValueError('Missing/extra SystemUI process')
    for p in processes:
        if not isinstance(p, dict) or any(type(p.get(k)) is not int or p[k] < 0 for k in ('user', 'uid', 'packageUid', 'pid', 'startTicks')):
            raise ValueError('Invalid SystemUI process metadata')
        if p['pid'] <= 0 or p['startTicks'] <= 0 or p['uid'] != p['packageUid'] or p['uid'] // USER_OFFSET != p['user'] or p.get('state') not in ('R', 'S', 'D', 'I'):
            raise ValueError('SystemUI ownership/state mismatch')
    if {p['user'] for p in processes} != expected or len({p['pid'] for p in processes}) != len(processes) or len({p['uid'] % USER_OFFSET for p in processes}) != 1:
        raise ValueError('SystemUI users, PIDs or package app IDs do not match')
    return tuple(sorted((p['user'], p['uid'], p['pid'], p['startTicks']) for p in processes))


def systemui_stable(samples, user):
    try:
        return len(samples) == 3 and len({systemui_identity(s, user) for s in samples}) == 1
    except (ValueError, TypeError):
        return False


def recheck_systemui(adb, baseline, expected_user):
    if baseline.get('status') != 'PASS' or baseline.get('serial') != adb.serial or baseline.get('avd') != AVD or baseline.get('currentUser') != expected_user or not systemui_stable(baseline.get('samples', []), expected_user):
        raise ValueError('Missing or invalid PASS SystemUI baseline')
    if adb.call(['emu', 'avd', 'name']).splitlines()[0] != AVD or adb.call(['shell', 'getprop', 'sys.boot_completed']) != '1':
        raise ValueError('AVD identity/boot changed')
    current = systemui_sample(adb)
    if systemui_identity(current, expected_user) != systemui_identity(baseline['samples'][0], expected_user):
        raise ValueError('SystemUI owner/PID/start time changed since PASS gate')
    return current


class Adb:
    def __init__(self, sdk, serial=SERIAL):
        if not re.fullmatch(r'emulator-\d+', serial):
            raise ValueError('Only an explicitly named emulator serial is allowed')
        self.sdk, self.serial, self.commands = Path(sdk), serial, []
        self.binary = self.sdk / 'platform-tools' / ('adb.exe' if os.name == 'nt' else 'adb')

    def call(self, args, *, targeted=True, timeout=5, binary=False):
        command = [str(self.binary), *(['-s', self.serial] if targeted else []), *args]
        start = time.monotonic()
        record = dict(args=args, targeted=targeted)
        try:
            p = subprocess.run(command, capture_output=True, timeout=timeout)
            record.update(exitCode=p.returncode, stdout=p.stdout.decode('utf8', 'replace') if not binary else '<binary>', stderr=p.stderr.decode('utf8', 'replace'))
            if p.returncode:
                raise RuntimeError('ADB command failed: ' + ' '.join(args))
            return p.stdout if binary else p.stdout.decode('utf8', 'replace').strip()
        except subprocess.TimeoutExpired:
            record['timeout'] = True
            raise RuntimeError('ADB command timed out: ' + ' '.join(args))
        finally:
            record['elapsedMs'] = round((time.monotonic() - start) * 1000)
            self.commands.append(record)


def sdk_inventory(sdk):
    sdk = Path(sdk)
    names = ['platform-tools/adb', 'emulator/emulator']
    tools = {name: (sdk / (name + ('.exe' if os.name == 'nt' else ''))).is_file() for name in names}
    tools['platforms/android-34/android.jar'] = (sdk / 'platforms/android-34/android.jar').is_file()
    return dict(pc=socket.gethostname(), os=platform.platform(), hostCpuCount=os.cpu_count(), sdk=str(sdk), files=tools,
                adbOnPath=shutil.which('adb'), declaredSdk='Vehicle 2.3.2', expectedService='2.3.22 (historical; not a current observation)')


def target_present(devices, serial):
    return any(line.split()[:2] == [serial, 'device'] for line in devices.splitlines())


def gate_reasons(r):
    """Conservative execution budget, not an OEM performance guarantee."""
    reasons = []
    if r.get('avd') != AVD: reasons.append('Wrong AVD identity')
    if r.get('boot') != '1' or r.get('api') != '34': reasons.append('Boot/API34 not ready')
    if r.get('memAvailableKiB', 0) < 524288: reasons.append('Less than 512MiB memory available')
    if r.get('storageAvailableKiB', 0) < 262144: reasons.append('Less than 256MiB /data storage available')
    if not r.get('webview'): reasons.append('No current WebView provider')
    if not r.get('serviceVersion') or r.get('serviceEnabled') != 'package:' + SERVICE: reasons.append('Vehicle Service unavailable for current user')
    if not str(r.get('currentUser', '')).isdigit(): reasons.append('Activity service did not return a user')
    if r.get('systemUiFatal'): reasons.append('Recent SystemUI fatal/ANR evidence')
    samples = r.get('samples', [])
    if not systemui_stable(samples, r.get('currentUser')):
        reasons.append('SystemUI owner/PID/start time or current user not stable over three samples')
    cpus = r.get('cpuCount', 0)
    if cpus < 1 or any(len(s['load']) != 3 or not all(math.isfinite(n) and n >= 0 for n in s['load'])
                       or s['load'][0] > cpus or s['load'][1] > 1.5 * cpus or not 0 <= s['adbMs'] <= 1000 for s in samples):
        reasons.append('CPU/load or ADB response budget exceeded')
    if any(c.get('elapsedMs', 0) > 2000 for c in r.get('serviceCommands', [])):
        reasons.append('System service response exceeds 2s')
    return reasons


def collect(adb, *, inventory=None, sleep=time.sleep):
    r = dict(collectedAt=datetime.now(timezone.utc).isoformat(), serial=adb.serial, status='BLOCKED', reasons=[],
             host=inventory or sdk_inventory(adb.sdk), deviceChecks='NOT_RUN', samples=[])
    try:
        if not all(r['host']['files'].values()):
            raise RuntimeError('Host SDK tools/API34 installation missing')
        r['devices'] = adb.call(['devices', '-l'], targeted=False)
        if not target_present(r['devices'], adb.serial):
            raise RuntimeError('Explicit target is absent/offline; no command sent to any other device')
        if adb.call(['get-state']) != 'device': raise RuntimeError('Target is not online')
        r['avd'] = adb.call(['emu', 'avd', 'name']).splitlines()[0]
        if r['avd'] != AVD: raise RuntimeError('Wrong AVD; no guest shell or mutation allowed')
        r['deviceChecks'] = 'COLLECTED'
        r['boot'] = adb.call(['shell', 'getprop', 'sys.boot_completed'])
        r['api'] = adb.call(['shell', 'getprop', 'ro.build.version.sdk'])
        r['cpus'] = adb.call(['shell', 'cat', '/sys/devices/system/cpu/online'])
        r['cpuCount'] = sum(int(s.split('-')[-1]) - int(s.split('-')[0]) + 1 for s in r['cpus'].split(','))
        r['meminfo'] = adb.call(['shell', 'cat', '/proc/meminfo'])
        r['memAvailableKiB'] = int(re.search(r'MemAvailable:\s+(\d+)', r['meminfo'])[1])
        r['df'] = adb.call(['shell', 'df', '-k', '/data'])
        r['storageAvailableKiB'] = int(r['df'].splitlines()[-1].split()[3])
        for _ in range(3):
            load = list(map(float, adb.call(['shell', 'cat', '/proc/loadavg']).split()[:3]))
            system_ui = systemui_sample(adb)
            adb.call(['shell', 'echo', 'CARSCOPE_I2_HEALTH'])
            r['samples'].append(dict(load=load, **system_ui, adbMs=adb.commands[-1]['elapsedMs']))
            sleep(1)
        r['serviceCommands'] = []
        def service(args):
            value = adb.call(args); r['serviceCommands'].append(adb.commands[-1]); return value
        r['currentUser'] = service(['shell', 'cmd', 'activity', 'get-current-user'])
        r['webviewRaw'] = service(['shell', 'dumpsys', 'webviewupdate'])
        found = re.search(r'Current WebView package \(name, version\): \(([^)]+)\)', r['webviewRaw'])
        r['webview'] = found[1] if found else None
        r['serviceRaw'] = service(['shell', 'dumpsys', 'package', SERVICE])
        found = re.search(r'versionName=([^\s]+)', r['serviceRaw'])
        r['serviceVersion'] = found[1] if found else None
        if not r['currentUser'].isdigit(): raise RuntimeError('Invalid Android user')
        r['serviceEnabled'] = service(['shell', 'cmd', 'package', 'list', 'packages', '-e', '--user', r['currentUser'], SERVICE])
        r['recentSystemLog'] = adb.call(['logcat', '-d', '-v', 'brief', '-t', '200', 'AndroidRuntime:E', 'ActivityManager:E', 'SystemUI:E', '*:S'])
        r['systemUiFatal'] = bool(re.search(r'(?:Process:|ANR in)\s+com\.android\.systemui|Process com\.android\.systemui\b[^\n]*has died', r['recentSystemLog']))
        r['reasons'] = gate_reasons(r)
        r['status'] = 'BLOCKED' if r['reasons'] else 'PASS'
    except (RuntimeError, OSError, ValueError, IndexError, TypeError) as e:
        r['reasons'].append(type(e).__name__ + ': ' + str(e))
    r['commands'] = adb.commands.copy()
    return r


if __name__ == '__main__':
    # The runtime pulse uses the very same ownership rules against the original PASS gate.
    import argparse
    import json
    parser = argparse.ArgumentParser(description='Read-only SystemUI identity recheck against a PASS health baseline')
    parser.add_argument('--sdk', required=True)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--expected-user', required=True)
    args = parser.parse_args()
    try:
        baseline = json.loads(args.baseline.read_text(encoding='utf8'))
        adb = Adb(args.sdk, args.serial)
        recheck_systemui(adb, baseline, args.expected_user)
        print('PASS: SystemUI ownership, start times and current user unchanged')
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as error:
        parser.exit(2, 'BLOCKED: ' + str(error) + '\n')
