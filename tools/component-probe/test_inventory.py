import unittest
from inventory import declarations


class InventoryTest(unittest.TestCase):
    def test_overloads_permissions_and_deprecation_do_not_bleed(self):
        raw = '''public interface example.Domain {
  public abstract void read(kotlin.jvm.functions.Function1);
    RuntimeInvisibleAnnotations:
      value="pleos.car.permission.CAR_ENERGY"
    Deprecated: true
  public abstract void read(kotlin.jvm.functions.Function2);
    RuntimeInvisibleAnnotations:
      value="pleos.car.permission.PRIVATE_CAR_ENERGY"
  public abstract void stop();
}'''
        rows = declarations(raw)
        self.assertEqual([r[0] for r in rows], ['read', 'read', 'stop'])
        self.assertEqual([r[2] for r in rows], [['pleos.car.permission.CAR_ENERGY'], ['pleos.car.permission.PRIVATE_CAR_ENERGY'], []])
        self.assertEqual([r[3] for r in rows], [True, False, False])


if __name__ == '__main__':
    unittest.main()
