// Test process only. AR-01's UUID/aids test mixes the real start clock with a fixed 2026-11-01 completion clock.
// Keep the original AR-01 files and every assertion; make its implicit clock agree with its explicit fixture.
Date.now = () => Date.parse('2026-11-01T09:00:00.000Z');
