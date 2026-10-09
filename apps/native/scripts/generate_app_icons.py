"""Package the existing Web mark on a warm-white application icon plate.

Run from repo root:
    uv run --directory apps/backend python ../native/scripts/generate_app_icons.py
No logo redesign or new dependency; Pillow is already a backend dependency.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps/web/src/assets/linkresume-mark.png"
MAC_PNG = ROOT / "apps/mac/Sources/LinkResumeApp/Resources/AppIcon.png"
MAC_ICNS = ROOT / "apps/mac/Resources/LinkResume.icns"
WINDOWS_ICO = ROOT / "apps/windows/src/LinkResume.App/Assets/LinkResume.ico"
ELECTRON_PNG = ROOT / "apps/desktop/build/icon.png"

for target in [MAC_PNG, MAC_ICNS, WINDOWS_ICO, ELECTRON_PNG]:
    target.parent.mkdir(parents=True, exist_ok=True)
with Image.open(SOURCE) as source:
    if source.width != source.height:
        raise ValueError("Application mark must be square")
    # Classic ICNS/ICO need a baked-in plate. Only its exterior is transparent.
    size = source.width
    scale = 4
    mask = Image.new("L", (size * scale, size * scale))
    ImageDraw.Draw(mask).rounded_rectangle(
        (size * scale * 0.06, size * scale * 0.06,
         size * scale * 0.94 - 1, size * scale * 0.94 - 1),
        radius=size * scale * 0.19, fill=255,
    )
    icon = Image.new("RGBA", (size, size), "#F7F5F0")
    icon.putalpha(mask.resize((size, size), Image.Resampling.LANCZOS))
    mark = source.convert("RGBA")
    mark = mark.crop(mark.getbbox())
    mark.thumbnail((int(size * 0.66), int(size * 0.66)), Image.Resampling.LANCZOS)
    icon.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    icon.save(MAC_PNG)
    icon.save(ELECTRON_PNG)
    icon.save(MAC_ICNS, format="ICNS")
    icon.save(WINDOWS_ICO, format="ICO", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
print("Updated Mac ICNS/runtime PNG, Windows ICO and Electron PNG: warm white #F7F5F0")
