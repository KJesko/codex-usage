"""Claude Code usage dashboard — a local, stdlib-only web UI over `ccusage`."""

from .app import VERSION as __version__

__all__ = ["__version__", "main"]

from .app import main
