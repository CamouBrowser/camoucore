import inspect
import warnings
from pathlib import Path
from typing import Optional, Set, Type

from yaml import CLoader, load

with open(Path(__file__).parent / 'warnings.yml', 'r') as _f:
    WARNINGS_DATA = load(_f, Loader=CLoader)

# Packages whose frames a warning skips: camoucore and every launcher built on it.
_INTERNAL: Set[Path] = {Path(__file__).parent}


def register_internal(package: Path) -> None:
    _INTERNAL.add(Path(package))


def _warn_from_caller(message: str, category: Type[Warning]) -> None:
    """Attribute the warning to the first frame outside camoucore and the
    launchers, so it points at the user's call rather than at their internals."""
    frame = inspect.currentframe()
    while frame:
        filename = Path(frame.f_code.co_filename)
        if not any(filename.is_relative_to(package) for package in _INTERNAL):
            break
        frame = frame.f_back

    if frame:
        warnings.warn_explicit(
            message,
            category=category,
            filename=frame.f_code.co_filename,
            lineno=frame.f_lineno,
        )
        return

    warnings.warn(message, category=category)


class LeakWarning(RuntimeWarning):
    """
    Raised when a the user has a setting enabled that can cause detection.
    """

    @staticmethod
    def warn(warning: str, i_know_what_im_doing: Optional[bool] = None) -> None:
        """
        Warns the user if a passed parameter can cause leaks. `warning` is the
        message itself: each launcher words its own.
        """
        if i_know_what_im_doing:
            return
        if i_know_what_im_doing is not None:
            warning += '\nIf this is intentional, pass `i_know_what_im_doing=True`.'
        _warn_from_caller(warning, LeakWarning)
