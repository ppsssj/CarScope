"""P3-V1: repeatable public AAR audit and debug/release isolation (stdlib only)."""
import argparse
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ANDROID = '{http://schemas.android.com/apk/res/android}'


def audit(aar, out):
    aar, out = aar.resolve(), out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise ValueError('AAR declarations must be written outside the repository')
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(aar) as z:
        data = z.read('classes.jar')
    javap = Path(os.environ['JAVA_HOME']) / 'bin' / ('javap.exe' if os.name == 'nt' else 'javap')
    with tempfile.TemporaryDirectory() as tmp:
        jar = Path(tmp) / 'classes.jar'
        jar.write_bytes(data)
        def inspect(cls, verbose=False):
            return subprocess.run([str(javap), '-classpath', str(jar), '-v' if verbose else '-public', cls], check=True, capture_output=True, text=True).stdout
        tire = inspect('ai.pleos.playground.vehicle.api.Tire', True)
        listener = inspect('ai.pleos.playground.vehicle.listener.TirePressureListener')
        wheels = inspect('ai.pleos.playground.vehicle.constant.area.WheelValue')
    expected = {
        'checkWheelAreaCapabilities': 'CAR_SAFETY',
        'checkLowTirePressureCapabilities': 'CAR_SAFETY', 'getLowTirePressure': 'CAR_SAFETY',
        'checkTirePressureCapabilities': 'PRIVATE_CAR_SAFETY', 'getTirePressure': 'PRIVATE_CAR_SAFETY',
        'registerTirePressure': 'PRIVATE_CAR_SAFETY', 'unregisterTirePressure': 'PRIVATE_CAR_SAFETY',
    }
    blocks = re.split(r'(?=  public abstract void )', tire)
    methods = {}
    for block in blocks:
        method = re.match(r'  public abstract void (\w+)\(', block)
        if method:
            permission = re.search(r'value="(pleos.car.permission.[^"]+)"', block)
            methods[method[1]] = permission[1] if permission else None
    assert methods == {m: 'pleos.car.permission.' + p for m, p in expected.items()}, methods
    assert 'onTirePressureUpdated(java.lang.Float)' in listener
    for wheel in ('LEFT_FRONT', 'RIGHT_FRONT', 'LEFT_REAR', 'RIGHT_REAR'):
        assert wheel + ';' in wheels
    assert 'getTirePressure' in tire and 'java.lang.Float' in tire
    (out / 'Tire.javap.txt').write_text(tire, encoding='utf8')
    (out / 'TirePressureListener.javap.txt').write_text(listener, encoding='utf8')
    (out / 'WheelValue.javap.txt').write_text(wheels, encoding='utf8')
    report = dict(aarSha256=hashlib.sha256(aar.read_bytes()).hexdigest(), classesSha256=hashlib.sha256(data).hexdigest(),
                  methods=methods, unitConfidence='UNVERIFIED', runtimeSupport='NOT_TESTED_BY_STATIC_AUDIT')
    (out / 'sdk-audit.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print('PASS: seven public Tire methods, Float listener, four wheel enums and permission annotations; runtime not implied')


def boundary():
    activity = 'io.carscope.app.tire.TireProbeActivity'
    tire_permissions = {'pleos.car.permission.CAR_SAFETY', 'pleos.car.permission.PRIVATE_CAR_SAFETY'}
    for variant in ('debug', 'release'):
        xml = ROOT / f'app/build/intermediates/merged_manifest/{variant}/process{variant.title()}MainManifest/AndroidManifest.xml'
        root = ET.parse(xml).getroot()
        activities = {n.get(ANDROID+'name') for n in root.iter('activity')}
        permissions = {n.get(ANDROID+'name') for n in root.iter('uses-permission')}
        assert (activity in activities) == (variant == 'debug')
        assert (tire_permissions <= permissions) if variant == 'debug' else not (tire_permissions & permissions)
        if variant == 'release':
            assert permissions == {'pleos.car.permission.CAR_DOORS', 'ai.pleos.playground.service.vehicle.VEHICLE_BINDING'}
    artifacts = [ROOT/'app/build/outputs/apk/debug/app-debug.apk', ROOT/'app/build/outputs/apk/release/app-release-unsigned.apk', ROOT/'app/build/outputs/bundle/release/app-release.aab']
    for file in artifacts:
        with zipfile.ZipFile(file) as z:
            dex = b''.join(z.read(n) for n in z.namelist() if n.endswith('.dex'))
        debug = file.name == 'app-debug.apk'
        for marker in (b'Lio/carscope/app/tire/TireProbeActivity;', b'Lio/carscope/app/tire/SdkTireSession;', b'Lio/carscope/app/tire/PleosTireDataSource;'):
            assert (marker in dex) == debug, (file.name, marker)
    print('PASS: Tire probe, controller, SDK transport and new permissions debug-only; release permissions unchanged')


def health(serial, out):
    out = out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise ValueError('Device evidence must stay outside the repository')
    out.mkdir(parents=True, exist_ok=True)
    result = {'collectedAt': datetime.now(timezone.utc).isoformat(), 'serial': serial, 'status': 'UNVERIFIED', 'sdkInitialization': 'NOT_RUN', 'capabilities': 'NOT_RUN', 'getters': 'NOT_RUN', 'events': 'NOT_RUN'}
    def adb(*args):
        return subprocess.run(['adb', '-s', serial, *args], check=True, capture_output=True, text=True, timeout=8).stdout.strip()
    try:
        result['avd'] = adb('emu', 'avd', 'name')
        result['cpus'] = adb('shell', 'cat', '/sys/devices/system/cpu/online')
        result['cpuCount'] = sum(int(part.split('-')[-1])-int(part.split('-')[0])+1 for part in result['cpus'].split(','))
        result['loadavg'] = adb('shell', 'cat', '/proc/loadavg')
        result['meminfo'] = '\n'.join(adb('shell', 'cat', '/proc/meminfo').splitlines()[:4])
        result['status'] = 'BLOCKED' if float(result['loadavg'].split()[0]) > result['cpuCount'] else 'NOT_RUN'
        result['reason'] = 'Read-only health check. Observed load above guest CPU count; no restart/install/start attempted.' if result['status'] == 'BLOCKED' else 'Health collection only; SDK runtime still requires the separate probe activity.'
    except (subprocess.SubprocessError, OSError) as e:
        result['status'] = 'BLOCKED'; result['reason'] = type(e).__name__ + ': ' + str(e)
    (out/'health.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sdk = sub.add_parser('sdk-audit'); sdk.add_argument('--aar', type=Path, required=True); sdk.add_argument('--out', type=Path, required=True)
    sub.add_parser('build-contract')
    device = sub.add_parser('health'); device.add_argument('--serial', default='emulator-5554'); device.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'sdk-audit': audit(args.aar, args.out)
    elif args.command == 'health': health(args.serial, args.out)
    else: boundary()
