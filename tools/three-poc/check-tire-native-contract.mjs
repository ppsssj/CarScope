// Read the synthetic JSON produced by the actual Kotlin projection test, then validate independently in JS.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateTireStatus } from './tire-status.mjs';
const text = readFileSync(process.argv[2] ?? 'app/build/test-results/tire-ui-v1.json', 'utf8');
const payload = validateTireStatus(JSON.parse(text));
assert.equal(payload.readings.length, 8);
assert.ok(payload.readings.every(r => r.source === 'MOCK'));
assert.equal(payload.readings.find(r => r.featureId === 'tire.pressure' && r.vehiclePartId === 'tire.front-left').availabilityStatus, 'STALE');
assert.equal(payload.sessionPhase, 'UNRESOLVED');
for (const field of ['value', 'unit', 'reason']) assert.ok(!text.includes('"' + field + '"'));
console.log('PASS: actual Kotlin serializer -> JS strict status-only contract (synthetic JVM data; no device runtime implied)');
