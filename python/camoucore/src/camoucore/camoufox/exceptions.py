from camoucore.exceptions import (  # noqa: F401 -- part of this package's API
    CorruptedDownload,
    UnsupportedOS,
    LocaleError,
    InvalidIP,
    InvalidProxy,
    UnknownIPLocation,
    InvalidLocale,
    UnknownTerritory,
    UnknownLanguage,
    NotInstalledGeoIPExtra,
    VirtualDisplayError,
    CannotFindXvfb,
    CannotExecuteXvfb,
    VirtualDisplayNotSupported,
    FpgenModelError,
)


class UnsupportedVersion(Exception):
    """
    Raised when the Camoufox executable is outdated.
    """

    ...


class MissingRelease(Exception):
    """
    Raised when a required GitHub release asset is missing.
    """

    ...


class UnsupportedArchitecture(Exception):
    """
    Raised when the architecture is not supported.
    """

    ...


class InvalidPropertyType(Exception):
    """
    Raised when the property type is invalid.
    """

    ...


class InvalidAddonPath(FileNotFoundError):
    """
    Raised when the addon path is invalid.
    """

    ...


class NonFirefoxFingerprint(Exception):
    """
    Raised when a passed fingerprint is not a Firefox fingerprint.
    """

    ...


class InvalidOS(ValueError):
    """
    Raised when the target OS is invalid.
    """

    ...


class GpuDisplayError(VirtualDisplayError):
    """
    Raised when the headless='virtual-gpu' display cannot be used.
    """

    ...


class NoGpuFound(GpuDisplayError):
    """
    Raised when no GPU render node with a PCI address is found.
    """

    ...


class AmbiguousGpuSelection(GpuDisplayError):
    """
    Raised when several GPUs match, or several exist and none was named.
    """

    ...


class GpuNotFound(GpuDisplayError):
    """
    Raised when the GPU selector matches no GPU.
    """

    ...


class CannotFindXorg(GpuDisplayError):
    """
    Raised when Xorg cannot be found.
    """

    ...


class CannotExecuteXorg(GpuDisplayError):
    """
    Raised when Xorg cannot be started, or exits right after starting.
    """

    ...


class GpuVtTakeover(GpuDisplayError):
    """
    Raised when the Xorg server switched the active console VT.
    """

    ...


class GpuSoftwareFallback(GpuDisplayError):
    """
    Raised when the browser on a GPU display never rendered on the GPU.
    """

    ...


class CamoufoxNotInstalled(FileNotFoundError):
    """
    Raised when camoufox is not installed.
    """

    ...


class ProfileDirectoryError(RuntimeError):
    """Raised when Camoufox's required runtime directory cannot be prepared."""

    ...


class UnknownProperty(KeyError):
    """
    Raised in strict mode (CAMOUFOX_STRICT_CONFIG=1) when the launcher writes a
    config key the browser's properties.json does not declare. Outside strict
    mode such a key is reported and skipped, so a newer library still launches
    an older build.
    """

    def __str__(self) -> str:
        return str(self.args[0]) if self.args else ''
