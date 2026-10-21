"""Keep the freezer entry outside the root, which also has codex_usage.py."""
from codex_usage.desktop import main

if __name__ == "__main__":
    raise SystemExit(main())
