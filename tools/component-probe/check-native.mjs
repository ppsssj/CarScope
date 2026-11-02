// Actual Kotlin synthetic projection -> independent JS consumer. No vehicle/runtime claim.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateComponentStatus } from '../three-poc/component-status.mjs';
const packet = validateComponentStatus(JSON.parse(readFileSync(process.argv[2] ?? 'app/build/test-results/component-ui-v1.json', 'utf8')));
assert.equal(packet.readings.length, 4);
assert.ok(packet.readings.every(r => r.source === 'MOCK' && r.observedAt === 1000 && r.availabilityStatus === 'STALE' && r.unit === null));
assert.equal(packet.readings.find(r => r.featureId === 'ev-battery.soc').value, 73);
assert.equal(packet.readings.find(r => r.featureId === 'safety.washer-fluid-warning').value, false);
assert.equal(packet.readings.find(r => r.featureId === 'safety.brake-fluid-level').value, 'LOW');
console.log('PASS: Kotlin component projection -> JS strict contract; synthetic MOCK, SOC has no verified unit');
console.log('COMPONENT_UI_SYNTHETIC_JSON ' + JSON.stringify(packet));
// Export only the already validated synthetic status-only Tire packet for desktop regression.
const { validateTireStatus } = await import('../three-poc/tire-status.mjs');
const tire = validateTireStatus(JSON.parse(readFileSync('app/build/test-results/tire-ui-v1.json', 'utf8')));
assert.ok(tire.readings.every(r => r.source === 'MOCK'));
console.log('TIRE_UI_SYNTHETIC_JSON ' + JSON.stringify(tire));
