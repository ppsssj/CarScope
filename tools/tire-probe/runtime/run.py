"""P3-I2 exact-target runtime harness. Default is read-only health collection, not installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
import zipfile
from health import Adb, AVD, SERIAL, collect

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = 'io.carscope.app'
CHECKS = ['inspection_launch', 'webview_render', 'model', 'four_tires', 'selection', 'highlight', 'native_projection',
          'webview_status', 'switch', 'camera_restore', 'pause_resume', 'recreation', 'probe_transfer',
          'late_sdk_callback', 'stale_error', 'sdk_capability', 'sdk_listener', 'sdk_release_ack', 'renderer_exit']


def external(path):
    p = Path(path).resolve()
    if p == ROOT or ROOT in p.parents: raise ValueError('Evidence must stay outside the repository')
    p.mkdir(parents=True, exist_ok=True)
    return p


def save(path, data):
    path.write_text(json.dumps(data, indent=2), encoding='utf8')


def apk_check(path):
    p = Path(path)
    if not p.is_file(): return dict(status='BLOCKED', reason='Debug APK does not exist', path=str(p))
    try:
        with zipfile.ZipFile(p) as z:
            dex = b''.join(z.read(n) for n in z.namelist() if n.endswith('.dex'))
            for marker in [b'Lio/carscope/app/lab/InspectionActivity;', b'Lio/carscope/app/tire/TireUiChannel;']:
                if marker not in dex: raise ValueError('Required debug class absent')
            for name in ['inspect.js', 'tire-status.mjs', 'android-inspect-shell.js', 'csp.txt']:
                if 'assets/inspection/' + name not in z.namelist(): raise ValueError('Required inspection asset absent')
            if any(n.endswith('.glb') for n in z.namelist()): raise ValueError('External GLB must not be bundled')
        return dict(status='PASS', path=str(p.resolve()), sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
                    reason='Offline debug class/asset preflight, not device execution')
    except (zipfile.BadZipFile, ValueError) as e: return dict(status='BLOCKED', reason=str(e))


def driver_result(path, run_id, exit_code):
    value = json.loads(path.read_text(encoding='utf8'))
    if value.get('runId') != run_id or value.get('status') not in ('PASS', 'FAIL', 'BLOCKED'):
        raise RuntimeError('Stale or invalid WebView evidence')
    if value['status'] == 'PASS' and exit_code != 0: raise RuntimeError('Driver exit contradicts PASS result')
    if not isinstance(value.get('checks'), dict) or any(not isinstance(c, dict) or c.get('status') not in ('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN') for c in value['checks'].values()):
        raise RuntimeError('Invalid driver check status')
    return value


def reconfirm(adb):
    if adb.call(['get-state']) != 'device' or adb.call(['emu', 'avd', 'name']).splitlines()[0] != AVD:
        raise RuntimeError('Target identity changed after gate')
    if adb.call(['shell', 'getprop', 'sys.boot_completed']) != '1': raise RuntimeError('Target stopped being boot-ready')


def inject_model(adb, path, user):
    """Same run-as, app-private, SHA-checked protocol as push-android-lab-model.mjs; bounded calls, unique temp."""
    p = Path(path)
    if not 12 <= p.stat().st_size <= 32 * 1024 * 1024: raise ValueError('Invalid/oversized GLB')
    data = p.read_bytes()
    if data[:4] != b'glTF' or int.from_bytes(data[4:8], 'little') != 2 or int.from_bytes(data[8:12], 'little') != len(data): raise ValueError('Invalid GLB header')
    sha = hashlib.sha256(data).hexdigest()
    prefix = f'run-as {PACKAGE} --user {user}'
    if 'uid=' not in adb.call(['shell', prefix + ' id']): raise RuntimeError('App is not debuggable for the current user')
    temporary = '/data/local/tmp/carscope-p3-i2-' + uuid.uuid4().hex + '.glb'
    target = 'files/debug-3d-assets/ioniq5.glb'
    adb.call(['push', str(p.resolve()), temporary], timeout=30)
    try:
        adb.call(['shell', f"cat {temporary} | {prefix} sh -c 'mkdir -p files/debug-3d-assets && cat > {target} && chmod 600 {target}'"], timeout=15)
    finally:
        adb.call(['shell', 'rm', '-f', temporary]) # this run's exact temporary file only
    remote = adb.call(['shell', prefix + ' sha256sum ' + target]).split()[0]
    if remote != sha: raise RuntimeError('App-private GLB hash mismatch')
    return dict(sha256=sha, size=len(data), target=target)


def run_device(adb, gate, out, apk, model, install=False):
    result = dict(status='BLOCKED', checks={name: dict(status='NOT_RUN') for name in CHECKS}, steps=[])
    if gate['status'] != 'PASS':
        result['reason'] = 'Health gate blocked; no install, input, start, forward or SDK call attempted'
        for c in result['checks'].values(): c.update(status='BLOCKED', reason='AVD health gate')
        return result
    port = None; launched = False; run_id = uuid.uuid4().hex
    result['runId'] = run_id
    try:
        reconfirm(adb)
        # Do not replace or foreground another Codex's live receiver/app. No force-stop is used.
        existing = adb.call(['shell', 'sh', '-c', f'pidof {PACKAGE} || true'])
        if existing: raise RuntimeError('CarScope already running; ownership unknown. Refusing install/launch over another task')
        user = gate['currentUser']
        aapt = adb.sdk / 'build-tools/35.0.0' / ('aapt.exe' if os.name == 'nt' else 'aapt')
        badging = subprocess.run([str(aapt), 'dump', 'badging', str(apk)], capture_output=True, text=True, timeout=10, check=True).stdout
        if "package: name='io.carscope.app'" not in badging or 'application-debuggable' not in badging:
            raise RuntimeError('Only the debuggable CarScope APK may be installed/run')
        if install:
            adb.call(['install', '-r', '--user', user, str(Path(apk).resolve())], timeout=60)
        installed = adb.call(['shell', 'pm', 'path', '--user', user, PACKAGE]).removeprefix('package:')
        if not re.fullmatch(r'/data/app/[\w./=+\-]+/base\.apk', installed): raise RuntimeError('Unrecognized installed APK path')
        installed_sha = adb.call(['shell', 'sha256sum', installed]).split()[0]
        if installed_sha != hashlib.sha256(Path(apk).read_bytes()).hexdigest(): raise RuntimeError('Installed APK does not match verified local debug APK')
        result['model'] = inject_model(adb, model, user)
        reconfirm(adb)
        started = adb.call(['shell', 'am', 'start', '--user', user, '-n', PACKAGE + '/.lab.InspectionActivity'])
        result['steps'].append(started)
        if 'Starting:' not in started or any(s in started for s in ['Error', 'Exception', 'Permission Denial']): raise RuntimeError('Activity launch was not accepted')
        launched = True
        # Look only at this package's current PID/socket. Do not attach to arbitrary WebViews.
        time.sleep(2)
        pid = adb.call(['shell', 'pidof', PACKAGE]).split()[0]
        if not pid.isdigit(): raise RuntimeError('No valid CarScope PID after launch')
        result['checks']['inspection_launch'] = dict(status='PASS', reason='am start accepted and package PID observed; rendering not implied', pid=pid)
        sockets = adb.call(['shell', 'cat', '/proc/net/unix'])
        name = 'webview_devtools_remote_' + pid
        if not re.search(r'@' + re.escape(name) + r'\s*$', sockets, re.M):
            raise RuntimeError('This app exposes no matching WebView DevTools socket; no bridge/debug setting is added')
        port = adb.call(['forward', 'tcp:0', 'localabstract:' + name])
        if not port.isdigit(): raise RuntimeError('Invalid allocated forwarding port')
        with zipfile.ZipFile(apk) as verified_apk:
            expected_csp = verified_apk.read('assets/inspection/csp.txt').decode('utf8').strip()
        p = subprocess.run(['node', str(Path(__file__).with_name('webview.mjs')), '--port=' + port, '--out=' + str(out),
                            '--adb=' + str(adb.binary), '--serial=' + adb.serial, '--user=' + user, '--cpus=' + str(gate['cpuCount']),
                            '--csp=' + expected_csp, '--run-id=' + run_id],
                           capture_output=True, text=True, timeout=240)
        (out / 'webview-driver.log').write_text(p.stdout + '\n' + p.stderr, encoding='utf8')
        if (out / 'webview-results.json').exists():
            web = driver_result(out / 'webview-results.json', run_id, p.returncode)
            result['checks'].update(web['checks']); result['status'] = web['status']
        else: raise RuntimeError('WebView driver returned no result')
    except (RuntimeError, OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as e:
        result['reason'] = str(e)
    finally:
        if port:
            try: adb.call(['forward', '--remove', 'tcp:' + port])
            except RuntimeError: result['forwardCleanup'] = 'FAIL: remove only this run forwarding manually'
        if launched:
            try:
                reconfirm(adb)
                log = adb.call(['logcat', '-d', '-v', 'threadtime', '-t', '1500', 'CarScopeTire:*', 'CarScopeInspection:*', 'AndroidRuntime:E', 'chromium:E', '*:S'])
                (out / 'logcat.txt').write_text(log, encoding='utf8')
                (out / 'final-screen.png').write_bytes(adb.call(['exec-out', 'screencap', '-p'], binary=True))
            except RuntimeError: result['capture'] = 'BLOCKED: target no longer responds'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--sdk', default=os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', '')))
    parser.add_argument('--serial', default=SERIAL)
    parser.add_argument('--run', action='store_true', help='After a fresh PASS gate only: inject private model, launch and inspect this app')
    parser.add_argument('--install', action='store_true', help='Requires --run, fresh gate and no existing CarScope process')
    parser.add_argument('--apk', default=str(ROOT / 'app/build/outputs/apk/debug/app-debug.apk'))
    parser.add_argument('--glb', default='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb')
    args = parser.parse_args()
    if args.install and not args.run: parser.error('--install requires --run')
    out = external(args.out); adb = Adb(args.sdk, args.serial)
    if any(out.iterdir()): parser.error('Use a fresh evidence directory; existing records are preserved')
    gate = collect(adb); save(out / 'health.json', gate)
    preflight = apk_check(args.apk); save(out / 'apk-preflight.json', preflight)
    if args.run and preflight['status'] == 'PASS': result = run_device(adb, gate, out, args.apk, args.glb, args.install)
    else:
        status = 'BLOCKED' if gate['status'] != 'PASS' or (args.run and preflight['status'] != 'PASS') else 'NOT_RUN'
        result = dict(status=status, checks={name: dict(status=status) for name in CHECKS}, reason='Health/preflight only; runtime not executed')
    save(out / 'results.json', result); save(out / 'commands.json', adb.commands)
    print(json.dumps(dict(health=gate['status'], reasons=gate['reasons'], apk=preflight['status'], runtime=result['status']), indent=2))
    return 0 if gate['status'] == 'PASS' and result['status'] not in ('BLOCKED', 'FAIL') else 2


if __name__ == '__main__': sys.exit(main())
