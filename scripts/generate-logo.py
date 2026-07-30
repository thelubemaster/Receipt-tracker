#!/usr/bin/env python3
"""Generate Project Cost Tracker logo PNGs (no school bus)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Brand palette (matches app CSS)
BG = (12, 14, 19, 255)  # #0c0e13
BG_SOFT = (20, 24, 32, 255)
TEAL = (45, 212, 191, 255)  # accent
TEAL_DIM = (15, 118, 110, 255)
TEAL_MID = (20, 160, 148, 255)
PAPER = (232, 247, 245, 255)
CORAL = (251, 146, 60, 255)  # #fb923c
CORAL_DIM = (234, 88, 12, 255)
WHITE = (255, 255, 255, 255)
LINE = (14, 40, 42, 230)
RING = (45, 212, 191, 70)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c1, c2, t: float):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(4))


def rounded_rect(draw: ImageDraw.ImageDraw, xy, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)


def draw_logo(size: int, *, with_app_bg: bool = True, pad_ratio: float = 0.08) -> Image.Image:
    """Draw the full app icon at `size` px."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    pad = int(s * pad_ratio)
    r = int(s * 0.22)

    if with_app_bg:
        # Soft radial vignette on dark card
        base = Image.new("RGBA", (s, s), BG)
        overlay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        # subtle teal glow top-left
        for i in range(12, 0, -1):
            alpha = int(18 * (i / 12))
            rad = int(s * 0.55 * (i / 12))
            od.ellipse(
                [int(s * 0.15) - rad, int(s * 0.1) - rad, int(s * 0.15) + rad, int(s * 0.1) + rad],
                fill=(45, 212, 191, alpha),
            )
        overlay = overlay.filter(ImageFilter.GaussianBlur(radius=s * 0.08))
        base = Image.alpha_composite(base, overlay)
        # rounded mask
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
        rounded = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        rounded.paste(base, (0, 0))
        img = Image.composite(rounded, img, mask)
        d = ImageDraw.Draw(img)
        # thin teal border
        d.rounded_rectangle(
            [s * 0.02, s * 0.02, s * 0.98 - 1, s * 0.98 - 1],
            radius=int(r * 0.92),
            outline=(45, 212, 191, 55),
            width=max(1, s // 128),
        )

    # --- content safe area ---
    # Project folder back plate
    fx0, fy0 = int(s * 0.18), int(s * 0.22)
    fx1, fy1 = int(s * 0.78), int(s * 0.78)
    tab_h = int(s * 0.08)
    tab_w = int(s * 0.28)
    # folder body
    folder = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    fd = ImageDraw.Draw(folder)
    # tab
    fd.rounded_rectangle(
        [fx0, fy0, fx0 + tab_w, fy0 + tab_h + int(s * 0.04)],
        radius=int(s * 0.03),
        fill=(36, 48, 58, 255),
    )
    fd.rounded_rectangle(
        [fx0, fy0 + tab_h, fx1, fy1],
        radius=int(s * 0.07),
        fill=(28, 38, 48, 255),
    )
    # inner folder face
    inset = int(s * 0.03)
    fd.rounded_rectangle(
        [fx0 + inset, fy0 + tab_h + inset, fx1 - inset, fy1 - inset],
        radius=int(s * 0.05),
        fill=(18, 26, 34, 255),
    )
    img = Image.alpha_composite(img, folder)
    d = ImageDraw.Draw(img)

    # Receipt (teal) sitting on folder
    rx0 = int(s * 0.30)
    ry0 = int(s * 0.28)
    rw = int(s * 0.36)
    rh = int(s * 0.46)
    rx1 = rx0 + rw
    ry1 = ry0 + rh

    receipt = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(receipt)
    # gradient-ish body via stacked rects
    for i in range(rh):
        t = i / max(rh - 1, 1)
        color = mix(TEAL, TEAL_DIM, t * 0.55)
        rd.line([(rx0, ry0 + i), (rx1, ry0 + i)], fill=color)
    # rounded top via mask-ish corners
    # cut jagged bottom (receipt tear)
    teeth = 7
    tooth_w = rw / teeth
    jag = int(s * 0.028)
    points = [(rx0, ry0 + int(s * 0.04))]
    # top-left corner curve approximated by going down from top
    points = [
        (rx0, ry0 + int(s * 0.05)),
        (rx0, ry1 - jag),
    ]
    for i in range(teeth + 1):
        x = rx0 + i * tooth_w
        y = ry1 if i % 2 == 0 else ry1 - jag
        points.append((x, y))
    points += [(rx1, ry0 + int(s * 0.05)), (rx1 - int(s * 0.05), ry0), (rx0 + int(s * 0.05), ry0)]
    # redraw clean receipt shape
    receipt = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(receipt)
    # main rounded body
    rd.rounded_rectangle(
        [rx0, ry0, rx1, ry1 - jag // 2],
        radius=int(s * 0.045),
        fill=TEAL_MID,
    )
    # top highlight
    rd.rounded_rectangle(
        [rx0, ry0, rx1, ry0 + int(rh * 0.35)],
        radius=int(s * 0.045),
        fill=TEAL,
    )
    # blend mid
    rd.rectangle([rx0, ry0 + int(rh * 0.22), rx1, ry0 + int(rh * 0.55)], fill=TEAL_MID)
    # jagged bottom
    jag_pts = [(rx0, ry1 - jag * 2)]
    for i in range(teeth + 1):
        x = rx0 + i * tooth_w
        y = (ry1 - 1) if i % 2 == 0 else (ry1 - jag * 2)
        jag_pts.append((int(x), int(y)))
    jag_pts.append((rx1, ry1 - jag * 2))
    rd.polygon(jag_pts, fill=TEAL_DIM)

    # folded corner
    fold = int(s * 0.09)
    rd.polygon(
        [
            (rx1 - fold, ry0),
            (rx1, ry0),
            (rx1, ry0 + fold),
        ],
        fill=mix(TEAL, (10, 40, 40, 255), 0.35),
    )
    rd.polygon(
        [
            (rx1 - fold, ry0),
            (rx1 - fold, ry0 + fold),
            (rx1, ry0 + fold),
        ],
        fill=mix(TEAL_DIM, (0, 0, 0, 255), 0.15),
    )

    # receipt lines
    lw = max(2, s // 64)
    for yi, wfrac in [(0.28, 0.62), (0.40, 0.55), (0.52, 0.48), (0.64, 0.40)]:
        y = int(ry0 + rh * yi)
        x0 = int(rx0 + rw * 0.14)
        x1 = int(rx0 + rw * (0.14 + wfrac))
        rd.line([(x0, y), (x1, y)], fill=(232, 247, 245, 210), width=lw)

    # small cost total bar
    bar_y = int(ry0 + rh * 0.78)
    rd.rounded_rectangle(
        [int(rx0 + rw * 0.14), bar_y, int(rx0 + rw * 0.72), bar_y + max(3, s // 48)],
        radius=max(1, s // 100),
        fill=(12, 40, 38, 160),
    )

    img = Image.alpha_composite(img, receipt)

    # Coral check badge (bottom-right of receipt)
    cx = int(rx1 - s * 0.02)
    cy = int(ry1 - s * 0.06)
    cr = int(s * 0.13)
    badge = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    # soft glow
    for i in range(6, 0, -1):
        bd.ellipse(
            [cx - cr - i * 2, cy - cr - i * 2, cx + cr + i * 2, cy + cr + i * 2],
            fill=(251, 146, 60, int(12 * (i / 6))),
        )
    bd.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=CORAL)
    # inner gradient ring
    bd.ellipse(
        [cx - int(cr * 0.78), cy - int(cr * 0.78), cx + int(cr * 0.78), cy + int(cr * 0.78)],
        outline=(255, 220, 180, 90),
        width=max(1, s // 120),
    )
    # check mark
    stroke = max(3, s // 28)
    p1 = (cx - cr * 0.42, cy + cr * 0.02)
    p2 = (cx - cr * 0.08, cy + cr * 0.38)
    p3 = (cx + cr * 0.48, cy - cr * 0.32)
    bd.line([p1, p2, p3], fill=WHITE, width=stroke, joint="curve")
    img = Image.alpha_composite(img, badge)

    # tiny project dots (multi-project hint) on folder
    dd = ImageDraw.Draw(img)
    dot_r = max(2, s // 55)
    for i, color in enumerate(
        [(91, 159, 212, 220), (92, 184, 138, 220), (232, 165, 75, 220)]
    ):
        dx = int(s * 0.58 + i * s * 0.07)
        dy = int(s * 0.34)
        dd.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=color)

    return img


def draw_foreground(size: int) -> Image.Image:
    """Adaptive icon foreground — transparent, content in safe center ~66%."""
    # Draw logo without outer card, slightly inset
    content = draw_logo(int(size * 0.72), with_app_bg=True, pad_ratio=0.06)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - content.size[0]) // 2
    img.paste(content, (off, off), content)
    return img


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024}KB)")


def main() -> None:
    print("Generating Project Cost Tracker logos…")
    master = draw_logo(1024)
    save(master, PUBLIC / "logo.png")

    for sz, name in [(192, "pwa-192.png"), (512, "pwa-512.png"), (180, "apple-touch-icon.png")]:
        save(master.resize((sz, sz), Image.Resampling.LANCZOS), PUBLIC / name)

    # Android legacy + adaptive foregrounds
    densities = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    # Adaptive foregrounds are 108dp * density; full canvas with transparent pad
    # mdpi 108, hdpi 162, xhdpi 216, xxhdpi 324, xxxhdpi 432
    adaptive = {
        "mdpi": 108,
        "hdpi": 162,
        "xhdpi": 216,
        "xxhdpi": 324,
        "xxxhdpi": 432,
    }

    for dens, sz in densities.items():
        icon = master.resize((sz, sz), Image.Resampling.LANCZOS)
        save(icon, ANDROID_RES / f"mipmap-{dens}" / "ic_launcher.png")
        save(icon, ANDROID_RES / f"mipmap-{dens}" / "ic_launcher_round.png")

    for dens, sz in adaptive.items():
        fg = draw_foreground(sz)
        save(fg, ANDROID_RES / f"mipmap-{dens}" / "ic_launcher_foreground.png")

    # Update adaptive background color resource
    bg_xml = ANDROID_RES / "values" / "ic_launcher_background.xml"
    bg_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="ic_launcher_background">#0c0e13</color>\n'
        "</resources>\n"
    )
    print(f"  wrote {bg_xml.relative_to(ROOT)}")

    # Simple vector background (optional solid)
    drawable_bg = ANDROID_RES / "drawable" / "ic_launcher_background.xml"
    drawable_bg.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#0c0e13"
        android:pathData="M0,0h108v108h-108z" />
</vector>
"""
    )
    print(f"  wrote {drawable_bg.relative_to(ROOT)}")
    print("Done.")


if __name__ == "__main__":
    main()
