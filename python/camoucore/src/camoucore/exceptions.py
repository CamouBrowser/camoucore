"""
Exceptions raised by camoucore. Each launcher re-exports them from its own
exceptions module, so a caller catches the same class either way.
"""


class CorruptedDownload(Exception):
    """
    Raised when a downloaded asset does not match its expected sha256 digest.
    """

    ...


class UnsupportedOS(Exception):
    """
    Raised when the OS is not supported.
    """

    ...


class LocaleError(Exception):
    """
    Raised when the locale is invalid.
    """

    ...


class InvalidIP(Exception):
    """
    Raised when an IP address is invalid.
    """

    ...


class InvalidProxy(Exception):
    """
    Raised when a proxy is invalid.
    """

    ...


class UnknownIPLocation(LocaleError):
    """
    Raised when the location of an IP is unknown.
    """

    ...


class InvalidLocale(LocaleError):
    """
    Raised when the locale input is invalid.
    """

    @classmethod
    def invalid_input(cls, locale: str) -> 'InvalidLocale':
        return cls(
            f"Invalid locale: '{locale}'. Must be either a region, language, "
            "language-region, or language-script-region."
        )


class UnknownTerritory(InvalidLocale):
    """
    Raised when the territory is unknown.
    """

    ...


class UnknownLanguage(InvalidLocale):
    """
    Raised when the language is unknown.
    """

    ...


class NotInstalledGeoIPExtra(ImportError):
    """
    Raised when the maxminddb module is not installed.
    """

    ...


class VirtualDisplayError(Exception):
    """
    Raised when there is an error with the virtual display.
    """

    ...


class CannotFindXvfb(VirtualDisplayError):
    """
    Raised when Xvfb cannot be found.
    """

    ...
    pass


class CannotExecuteXvfb(VirtualDisplayError):
    """
    Raised when Xvfb cannot be executed.
    """

    ...


class VirtualDisplayNotSupported(VirtualDisplayError):
    """
    Raised when the user tried to use a virtual display on a non-Linux OS.
    """

    ...


class FpgenModelError(RuntimeError):
    """Raised when fpgen's pinned model cannot be installed where fpgen reads it."""

    ...


