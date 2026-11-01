"""Read-only Sync preflight. No app launch, installation, reverse, CA changes or SDK mutation."""
import argparse
import datetime
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
SERVICE = 'ai.pleos.playground.service.vehicle'
AVD = 'CarScope_Pleos_API34'


def origin(value):
    try:
        u = urlsplit(value)
        if (u.scheme != 'https' or not u.hostname or u.username is not None or u.password is not None
                or u.path not in ('', '/') or '?' in value or '#' in value or not u.netloc
                or any(ord(c) <= 32 or ord(c) > 126 for c in value) or '\\' in value):
            raise ValueError()
        if u.port is not None and not 1 <= u.port <= 65535:
            raise ValueError()
        return u
    except ValueError:
        raise ValueError('INVALID_HTTPS_ORIGIN') from None


def cli_origin(value):
    try:
        return origin(value)
    except ValueError:
        raise argparse.ArgumentTypeError('INVALID_HTTPS_ORIGIN (credentials/query/fragment/path forbidden)') from None


def host_probe(value):
    u = origin(value)
    connection = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=5, context=ssl.create_default_context())
    try:
        # No credentials, writes, or redirects. This is host trust, never Android trust.
        connection.request('GET', '/v1/sessions/00000000-0000-4000-8000-000000000000', headers={'Accept': 'application/json'})
        r = connection.getresponse()
        body = r.read(16385)
        correct = r.status == 401 and len(body) <= 16384 and r.getheader('Content-Type', '').lower().split(';')[0].strip() == 'application/json'
        correct = correct and json.loads(body) == {'error': {'code': 'UNAUTHORIZED'}}
        return {'status': 'PASS' if correct else 'FAIL', 'scope': 'HOST_TLS_AND_API_ONLY', 'httpStatus': r.status}
    except Exception:
        return {'status': 'FAIL', 'scope': 'HOST_TLS_AND_API_ONLY', 'reason': 'TLS_NETWORK_OR_API_FAILURE'}
    finally:
        connection.close()


def collect(sdk, serial, run=None):
    if not re.fullmatch(r'emulator-[0-9]+', serial):
        raise ValueError('EXPLICIT_EMULATOR_SERIAL_REQUIRED')
    adb = str(Path(sdk) / 'platform-tools' / ('adb.exe' if os.name == 'nt' else 'adb'))
    def call(args, targeted=True):
        command = [adb, *(['-s', serial] if targeted else []), *args]
        if run is not None:
            return run(command).strip()
        p = subprocess.run(command, capture_output=True, timeout=5, check=True)
        return p.stdout.decode('utf8', 'replace').strip()
    out = {'status': 'BLOCKED', 'serial': serial, 'expectedAvd': AVD, 'reason': 'NO_EXACT_CONNECTED_DEVICE'}
    try:
        devices = call(['devices', '-l'], False)
        if not any(line.split()[:2] == [serial, 'device'] for line in devices.splitlines()):
            return out
        avd = call(['emu', 'avd', 'name']).splitlines()[0]
        if avd != AVD:
            out['reason'] = 'WRONG_AVD_IDENTITY'; return out
        out['avd'] = avd
        out['bootCompleted'] = call(['shell', 'getprop', 'sys.boot_completed'])
        out['android'] = call(['shell', 'getprop', 'ro.build.version.release'])
        out['api'] = call(['shell', 'getprop', 'ro.build.version.sdk'])
        out['systemUiPid'] = call(['shell', 'pidof', 'com.android.systemui'])
        webview = call(['shell', 'dumpsys', 'webviewupdate'])
        match = re.search(r'Current WebView package \(name, version\): \(([^)]+)\)', webview)
        out['webview'] = match[1] if match else None
        user = call(['shell', 'cmd', 'activity', 'get-current-user'])
        if not user.isdigit():
            out['reason'] = 'INVALID_CURRENT_USER'; return out
        package = call(['shell', 'dumpsys', 'package', SERVICE])
        match = re.search(r'versionName=([^\s]+)', package)
        out['vehicleServiceVersion'] = match[1] if match else None
        enabled = call(['shell', 'cmd', 'package', 'list', 'packages', '-e', '--user', user, SERVICE])
        out['vehicleServiceEnabled'] = enabled == 'package:' + SERVICE
        ready = (out['bootCompleted'] == '1' and out['api'] == '34' and out['systemUiPid'].isdigit()
                 and out['webview'] and out['vehicleServiceVersion'] and out['vehicleServiceEnabled'])
        out['status'] = 'PASS' if ready else 'BLOCKED'
        out['reason'] = 'READ_ONLY_IDENTITY_SNAPSHOT_ONLY' if ready else 'DEVICE_HEALTH_PREREQUISITE_MISSING'
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        out['reason'] = 'ADB_UNAVAILABLE_OR_READ_FAILED'
    return out


def external_report(value):
    p = Path(value).resolve()
    if p == ROOT or ROOT in p.parents:
        raise ValueError('EVIDENCE_MUST_BE_OUTSIDE_CHECKOUT')
    return p


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', required=True)
    parser.add_argument('--serial', required=True, help='Exact emulator serial; never auto-select a device')
    parser.add_argument('--api-origin', type=cli_origin)
    parser.add_argument('--probe-host', action='store_true', help='Opt-in credential-free host HTTPS GET; no Android TLS claim')
    parser.add_argument('--report', required=True, type=external_report)
    args = parser.parse_args()
    if args.probe_host and args.api_origin is None:
        parser.error('--probe-host requires --api-origin')
    report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'kind': 'SYNC_READ_ONLY_READINESS',
              'deviceInventory': collect(args.sdk, args.serial),
              'hostHttps': host_probe(args.api_origin.geturl()) if args.probe_host else {'status': 'NOT_RUN'},
              'androidHttps': {'status': 'BLOCKED', 'reason': 'MUST_RUN_NATIVE_CHECK_CONNECTION_WITH_DEVICE_TRUST'},
              'phoneHttps': {'status': 'BLOCKED', 'reason': 'PHONE_TRUST_AND_REACHABILITY_REQUIRED'},
              'creationAuthorization': {'status': 'BLOCKED', 'reason': 'DENY_BY_DEFAULT_PROVIDER_UNCHANGED'},
              'twoDeviceE2E': {'status': 'BLOCKED'},
              'artifactIsolation': {'status': 'NOT_RUN', 'command': 'python tools/inspection-sync-poc/android/check-boundary.py'}}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
