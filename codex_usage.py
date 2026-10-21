#!/usr/bin/env python3
"""Run the local checkout without installing the package."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
from codex_usage.app import main

if __name__ == "__main__":
    main()
