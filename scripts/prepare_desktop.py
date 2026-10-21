"""Prepare code-drawn app icons and bundled dependency notices before freezing."""
from importlib import metadata
from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
image = Image.new("RGBA", (640, 640), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 639, 639), radius=192, fill="#173e32")
for points in (((14, 12), (7, 20), (14, 28)), ((26, 12), (33, 20), (26, 28)), ((22, 10), (18, 30))):
    coords = [(x * 16, y * 16) for x, y in points]
    draw.line(coords, fill="#b8f2d5", width=45, joint="curve")
    for x, y in coords:
        draw.ellipse((x - 22, y - 22, x + 22, y + 22), fill="#b8f2d5")
image.save(ROOT / "src/codex_usage/static/icon.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])

notices = ["Third-party software included in Codex Usage for Windows\n"]
python_license = Path(sys.base_prefix) / "LICENSE.txt"
if python_license.exists():
    notices += ["\n=== Python ===\n", python_license.read_text(encoding="utf-8")]
for name in ("pywebview", "pythonnet", "clr_loader", "cffi", "pycparser", "bottle", "proxy_tools",
             "typing_extensions", "tzdata", "pyinstaller", "pyinstaller-hooks-contrib"):
    dist = metadata.distribution(name)
    notices.append(f"\n=== {dist.metadata['Name']} {dist.version} ===\n")
    for file in dist.files or []:
        if any(part.lower().startswith(("license", "copying", "notice")) for part in file.parts):
            path = Path(dist.locate_file(file))
            if path.is_file():
                notices.extend([f"\n--- {file} ---\n", path.read_text(encoding="utf-8", errors="replace")])
    # WebView2 runtime is supplied by the operating system; bundled SDK DLLs have their own terms.
    if name == "pywebview":
        notices.append("\nWebView2 SDK: https://www.nuget.org/packages/Microsoft.Web.WebView2\n")
(ROOT / "build").mkdir(exist_ok=True)
(ROOT / "build/THIRD-PARTY-LICENSES.txt").write_text("\n".join(notices), encoding="utf-8")
print("Prepared Windows icon and third-party notices")
