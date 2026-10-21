"""Windows executable entry point; also usable from a source checkout."""
import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from codex_usage.desktop import main

if __name__ == "__main__":
    raise SystemExit(main())
