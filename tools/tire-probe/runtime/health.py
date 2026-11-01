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
    if len(samples) != 3 or len({s.get('systemUiPid') for s in samples}) != 1 or not all(str(s.get('systemUiPid', '')).isdigit() for s in samples):
        reasons.append('SystemUI not stable over three samples')
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
            pid = adb.call(['shell', 'pidof', 'com.android.systemui'])
            adb.call(['shell', 'echo', 'CARSCOPE_I2_HEALTH'])
            r['samples'].append(dict(load=load, systemUiPid=pid, adbMs=adb.commands[-1]['elapsedMs']))
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
        r['systemUiFatal'] = bool(re.search(r'(?:Process:|ANR in)\s+com\.android\.systemui', r['recentSystemLog']))
        r['reasons'] = gate_reasons(r)
        r['status'] = 'BLOCKED' if r['reasons'] else 'PASS'
    except (RuntimeError, OSError, ValueError, IndexError, TypeError) as e:
        r['reasons'].append(type(e).__name__ + ': ' + str(e))
    r['commands'] = adb.commands.copy()
    return r
