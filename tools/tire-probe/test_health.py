"""No device access: exercise the probe gate policy with synthetic health records."""
import copy
import unittest
from check import health_passes


class HealthGateTest(unittest.TestCase):
    def setUp(self):
        self.record = dict(deviceState='device', avd='CarScope_Pleos_API34\nOK', bootCompleted='1',
                           cpuCount=2, availableKiB=524288,
                           samples=[dict(load='2.00 3.00 1.00 1/100 42', adbMs=1000) for _ in range(3)],
                           activityService='0', packageService='package:ai.pleos.playground.service.vehicle',
                           activityMs=2000, packageMs=2000)

    def test_all_budgets_required(self):
        self.assertTrue(health_passes(self.record))
        for key, value in [('deviceState', 'offline'), ('avd', 'other'), ('bootCompleted', '0'),
                           ('availableKiB', 524287), ('activityMs', 2001), ('packageMs', 2001),
                           ('activityService', 'Error'), ('packageService', '')]:
            with self.subTest(key=key):
                record = dict(self.record, **{key: value})
                self.assertFalse(health_passes(record))

    def test_each_load_and_latency_sample_must_pass(self):
        for sample in [dict(load='2.01 1.0 1.0', adbMs=20), dict(load='1.0 3.01 1.0', adbMs=20),
                       dict(load='1.0 1.0 1.0', adbMs=1001)]:
            record = copy.deepcopy(self.record)
            record['samples'][1] = sample
            self.assertFalse(health_passes(record))
        self.record['samples'].pop()
        self.assertFalse(health_passes(self.record))


if __name__ == '__main__':
    unittest.main()
