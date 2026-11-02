"""Static public Vehicle 2.3.2 declarations and Debug-only component integration. Never invokes adb."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SHA = 'e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937'
EXPECTED = {
    'Safety': ['checkLowWasherFluidWarningStateCapabilities', 'hasLowWasherFluidWarning', 'registerLowWasherFluidWaringState', 'unregisterLowWasherFluidWaringState', 'checkBrakeFluidLevelStateCapabilities', 'getBrakeFluidLevelState', 'registerBrakeFluidLevelState', 'unregisterBrakeFluidLevelState'],
    'EvBattery': ['checkEvBatteryStateOfChargeCapabilities', 'getEvBatteryStateOfCharge', 'registerEvBatteryStateOfCharge', 'unregisterEvBatteryStateOfCharge', 'checkEvChargeSwitchCapabilities', 'getEvChargeSwitchState', 'checkEvChargePortOpenCapabilities', 'isEvChargePortOpen', 'registerEvChargePortOpen', 'unregisterEvChargePortOpen'],
}


def audit(aar, out):
    if aar is None:
        cache = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle'))
        matches = list((cache / 'caches/modules-2/files-2.1/ai.pleos.playground/Vehicle/2.3.2').glob('*/*.aar'))
        if len(matches) != 1:
            raise ValueError('Exactly one cached Vehicle 2.3.2 AAR required, or use --aar')
        aar = matches[0]
    out = out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise ValueError('Raw SDK evidence must be outside checkout')
    out.mkdir(parents=True, exist_ok=True)
    assert hashlib.sha256(aar.read_bytes()).hexdigest() == SHA, 'Vehicle AAR hash mismatch'
    with zipfile.ZipFile(aar) as archive:
        data = archive.read('classes.jar')
    javap = Path(os.environ['JAVA_HOME']) / 'bin' / ('javap.exe' if os.name == 'nt' else 'javap')
    methods = {}
    with tempfile.TemporaryDirectory(prefix='carscope-component-sdk-') as temp:
        jar = Path(temp) / 'classes.jar'; jar.write_bytes(data)
        classes = ['api.Safety', 'api.EvBattery', 'api.Light', 'api.Wiper', 'Vehicle', 'constant.control.OilLevelState', 'constant.area.WindowValue', 'listener.LowWasherFluidWaringListener', 'listener.OilLevelStateListener', 'listener.EvBatteryStateOfChargeListener', 'listener.EvChargePortOpenListener', 'listener.VehicleListener']
        for cls in classes:
            value = subprocess.run([str(javap), '-classpath', str(jar), '-v', 'ai.pleos.playground.vehicle.' + cls], capture_output=True, text=True, check=True).stdout
            (out / (cls + '.txt')).write_text(value, encoding='utf8')
            name = cls.rsplit('.', 1)[-1]
            if name in EXPECTED:
                blocks = re.split(r'(?=  public abstract void )', value)
                for method in EXPECTED[name]:
                    block = next(b for b in blocks if b.startswith('  public abstract void ' + method + '('))
                    permission = re.search(r'value="(pleos.car.permission.[^"]+)"', block)
                    expected = 'pleos.car.permission.CAR_SAFETY' if name == 'Safety' else 'pleos.car.permission.CAR_ENERGY'
                    assert permission and permission[1] == expected, method
                    methods[method] = {'permission': expected, 'signature': block.splitlines()[0].strip()}
                    if method in ('isEvChargePortOpen', 'registerEvChargePortOpen', 'unregisterEvChargePortOpen'):
                        assert 'Deprecated: true' in block and 'use the Google EV_CHARGE_PORT_OPEN property' in block
                        assert 'DeprecationLevel;.ERROR' not in block and 'DeprecationLevel;.HIDDEN' not in block
                        methods[method]['deprecated'] = 'WARNING'
                if name == 'Safety':
                    assert 'hasLowWasherFluidWarning(kotlin.jvm.functions.Function1<? super java.lang.Boolean' in value
                    assert 'getBrakeFluidLevelState(kotlin.jvm.functions.Function1<? super ai.pleos.playground.vehicle.constant.control.OilLevelState' in value
                else:
                    assert 'getEvBatteryStateOfCharge(kotlin.jvm.functions.Function1<? super java.lang.Integer' in value
                    assert 'getEvChargeSwitchState(kotlin.jvm.functions.Function1<? super java.lang.Boolean' in value
                    assert 'isEvChargePortOpen(kotlin.jvm.functions.Function1<? super java.lang.Boolean' in value
                    assert 'checkEvChargePortOpenCapabilities(kotlin.jvm.functions.Function1<? super ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig' in value
            if name == 'EvChargePortOpenListener':
                assert 'onEvChargePortOpenUpdated(java.lang.Boolean)' in value and 'extends ai.pleos.playground.vehicle.listener.VehicleListener' in value
            if name == 'VehicleListener':
                assert 'onFailed(java.lang.Exception)' in value
            if name == 'Vehicle':
                assert all(' get' + domain + '();' in value for domain in ('Safety', 'EvBattery', 'Light', 'Wiper'))
            if name == 'OilLevelState':
                assert all('OilLevelState ' + state + ';' in value for state in ('LOW', 'HIGH', 'NORMAL', 'ERROR', 'CRITICALLY_LOW'))
    (out / 'summary.json').write_text(json.dumps({'aarSha256': SHA, 'classesSha256': hashlib.sha256(data).hexdigest(), 'methods': methods, 'runtime': 'NOT_RUN', 'socUnitAndRange': 'UNVERIFIED'}, indent=2), encoding='utf8')
    print('PASS: public Safety/EV declarations, callbacks and permissions; Light/Wiper inventory saved; runtime NOT_RUN')


def boundary():
    ns = '{http://schemas.android.com/apk/res/android}'
    for variant in ('debug', 'release'):
        manifest = ROOT / f'app/build/intermediates/merged_manifest/{variant}/process{variant.title()}MainManifest/AndroidManifest.xml'
        permissions = {n.get(ns + 'name') for n in ET.parse(manifest).getroot().iter('uses-permission')}
        assert ('pleos.car.permission.CAR_ENERGY' in permissions) == (variant == 'debug')
        assert not any(p.startswith('pleos.car.permission.CONTROL_') for p in permissions)
        if variant == 'release':
            assert permissions == {'pleos.car.permission.CAR_DOORS', 'ai.pleos.playground.service.vehicle.VEHICLE_BINDING'}
    artifacts = [('app/build/outputs/apk/debug/app-debug.apk', True), ('app/build/outputs/apk/release/app-release-unsigned.apk', False), ('app/build/outputs/bundle/release/app-release.aab', False)]
    for path, debug in artifacts:
        with zipfile.ZipFile(ROOT / path) as archive:
            dex = b''.join(archive.read(n) for n in archive.namelist() if n.endswith('.dex'))
            for name in ('SdkComponentSession', 'PleosComponentDataSource', 'ComponentUiChannel', 'ComponentOwner', 'ComponentUiProjection'):
                assert (f'Lio/carscope/app/component/{name};'.encode() in dex) == debug, (path, name)
            assert b'Lio/carscope/app/component/ComponentFakeSession;' not in dex
            if debug:
                assert 'assets/inspection/component-status.mjs' in archive.namelist()
                assert 'assets/inspection/ev-charge-status.mjs' in archive.namelist()
            else:
                assert b'ev-charge-status.json' not in dex
                assert not any('ev-charge-status' in n for n in archive.namelist())
                assert not any('component-status' in n or '/component/' in n for n in archive.namelist())
                assert b'Lio/carscope/app/component/' not in dex
    for cls, count in [('component.PleosComponentDataSourceTest', 14), ('component.ComponentUiProjectionTest', 4), ('lab.ComponentWebBoundaryTest', 2), ('component.ChargePortDataTest', 4), ('lab.ChargePortWebTest', 2)]:
        suite = ET.parse(ROOT / f'app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.{cls}.xml').getroot()
        assert int(suite.get('tests')) >= count
        assert all(int(suite.get(k, 0)) == 0 for k in ('failures', 'errors', 'skipped'))
        print(f'PASS: {cls}: {suite.get("tests")} synthetic JVM/Robolectric tests')
    print('PASS: component code/assets and CAR_ENERGY Debug-only; Release permissions unchanged; no control permission')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['sdk-audit', 'boundary']); p.add_argument('--aar', type=Path)
    p.add_argument('--out', type=Path, default=Path(tempfile.gettempdir()) / 'carscope-component-sdk-audit')
    args = p.parse_args()
    audit(args.aar, args.out) if args.command == 'sdk-audit' else boundary()
