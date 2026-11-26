"""PyYAML's fast C loader and dumper, or its pure-Python ones where it was built
without libyaml (as on a Python it has no wheel for yet)."""

try:
    from yaml import CDumper as Dumper
    from yaml import CLoader as Loader
except ImportError:
    from yaml import Dumper, Loader  # noqa: F401
