#!/usr/bin/env python3
"""
Project Cost Tracker logo — bold infinity / rising-path mark.
(Drastic redesign: no bus, no folder, no receipt paper.)
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

BG = (10, 14, 22, 255)
TEAL_HI = (94, 234, 212, 255)  # #5eead4
TEAL = (45, 212, 191, 255)  # #2dd4bf
TEAL_MID = (20, 184, 166, 255)
TEAL_DIM = (13, 148, 136, 255)
CORAL = (251, 113, 133, 255)  # warmer coral-rose peak
CORAL_GLOW = (251, 146, 60, 255)
WHITE = (255, 255, 255, 255)
SILVER = (226, 232, 240, 255)


def draw_logo(size: int, *, with_app_bg: bool = True) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    if with_app_bg:
        base = Image.new("RGBA", (s, s), BG)
        # subtle radial teal glow center
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for i in range(14, 0, -1):
            a = int(22 * (i / 14))
            r = int(s * 0.42 * (i / 14))
            gd.ellipse([s // 2 - r, s // 2 - r, s // 2 + r, s // 2 + r], fill=(45, 212, 191, a))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=max(1, s // 18)))
        base = Image.alpha_composite(base, glow)
        # rounded mask
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
        rounded = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        rounded.paste(base, (0, 0))
        img = Image.composite(rounded, img, mask)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle(
            [s * 0.025, s * 0.025, s * 0.975 - 1, s * 0.975 - 1],
            radius=int(s * 0.20),
            outline=(45, 212, 191, 40),
            width=max(1, s // 140),
        )
    else:
        d = ImageDraw.Draw(img)

    # --- Infinity / rising path as thick parametric stroke ---
    # Left loop (coin feel) + right rising loop ending at coral peak
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)

    cx, cy = s * 0.48, s * 0.52
    # parametric infinity: x = a sin t, y = a sin t cos t  (lemniscate-ish)
    a = s * 0.22
    pts_main: list[tuple[float, float]] = []
    for i in range(0, 361, 2):
        t = math.radians(i)
        # Horizontal figure-8, then lift the right side
        x = cx + a * 1.35 * math.sin(t)
        y = cy + a * 0.95 * math.sin(t) * math.cos(t)
        # lift right half upward into a peak
        if math.sin(t) > 0:
            lift = (math.sin(t) ** 1.2) * s * 0.10
            y -= lift
            x += s * 0.02 * math.sin(t)
        pts_main.append((x, y))

    # Widen path by drawing multiple offset strokes with gradient colors
    width = max(6, int(s * 0.11))
    n = len(pts_main)

    def draw_thick_polyline(draw, points, w, fill):
        if len(points) < 2:
            return
        # draw circles along path for round joints
        r = max(1, w // 2)
        for x, y in points:
            draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)
        draw.line(points, fill=fill, width=w, joint="curve")

    # Outer dim body
    draw_thick_polyline(ld, pts_main, width + max(2, s // 80), (*TEAL_DIM[:3], 220))
    # Mid teal
    draw_thick_polyline(ld, pts_main, width, (*TEAL[:3], 255))
    # Highlight edge (upper samples)
    hi_pts = []
    for i, (x, y) in enumerate(pts_main):
        # offset "up-left" for highlight
        hi_pts.append((x - s * 0.012, y - s * 0.014))
    draw_thick_polyline(ld, hi_pts, max(2, width // 3), (*TEAL_HI[:3], 160))

    # Left "coin" ring accent (segment of left loop)
    coin_pts = []
    for i in range(200, 340, 2):
        t = math.radians(i)
        x = cx + a * 1.35 * math.sin(t)
        y = cy + a * 0.95 * math.sin(t) * math.cos(t)
        coin_pts.append((x, y))
    if len(coin_pts) > 2:
        draw_thick_polyline(ld, coin_pts, max(2, width // 4), (*SILVER[:3], 200))
        # tick marks on left loop
        for k in range(5):
            t = math.radians(220 + k * 18)
            x0 = cx + a * 1.12 * math.sin(t)
            y0 = cy + a * 0.78 * math.sin(t) * math.cos(t)
            x1 = cx + a * 1.48 * math.sin(t)
            y1 = cy + a * 1.05 * math.sin(t) * math.cos(t)
            ld.line([(x0, y0), (x1, y1)], fill=(*SILVER[:3], 140), width=max(1, s // 160))

    layer = layer.filter(ImageFilter.GaussianBlur(radius=max(0.4, s / 900)))
    # re-draw sharp center after light blur for softness without mush
    sharp = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sharp)
    draw_thick_polyline(sd, pts_main, max(4, int(width * 0.72)), TEAL)
    draw_thick_polyline(sd, hi_pts[::2], max(2, width // 4), (*TEAL_HI[:3], 200))

    img = Image.alpha_composite(img, layer)
    img = Image.alpha_composite(img, sharp)

    # Coral peak node at end of rising path (rightmost high point)
    # find min y among right half
    peak = min((p for p in pts_main if p[0] > cx), key=lambda p: p[1], default=(cx + a, cy - a))
    px, py = peak[0] + s * 0.01, peak[1] - s * 0.02
    pr = s * 0.055
    badge = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    for i in range(8, 0, -1):
        bd.ellipse(
            [px - pr - i * 2, py - pr - i * 2, px + pr + i * 2, py + pr + i * 2],
            fill=(251, 113, 133, int(16 * (i / 8))),
        )
    bd.ellipse([px - pr, py - pr, px + pr, py + pr], fill=CORAL_GLOW)
    bd.ellipse(
        [px - pr * 0.55, py - pr * 0.55, px + pr * 0.35, py + pr * 0.35],
        fill=(255, 220, 200, 90),
    )
    img = Image.alpha_composite(img, badge)

    return img


def draw_foreground(size: int) -> Image.Image:
    content = draw_logo(int(size * 0.72), with_app_bg=True)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - content.size[0]) // 2
    img.paste(content, (off, off), content)
    return img


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024}KB)")


def main() -> None:
    print("Generating infinity-path Project Cost Tracker logo…")
    master = draw_logo(1024)
    save(master, PUBLIC / "logo.png")
    for sz, name in [(192, "pwa-192.png"), (512, "pwa-512.png"), (180, "apple-touch-icon.png")]:
        save(master.resize((sz, sz), Image.Resampling.LANCZOS), PUBLIC / name)

    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    adaptive = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

    for dens, sz in densities.items():
        icon = master.resize((sz, sz), Image.Resampling.LANCZOS)
        save(icon, ANDROID_RES / f"mipmap-{dens}" / "ic_launcher.png")
        save(icon, ANDROID_RES / f"mipmap-{dens}" / "ic_launcher_round.png")

    for dens, sz in adaptive.items():
        save(draw_foreground(sz), ANDROID_RES / f"mipmap-{dens}" / "ic_launcher_foreground.png")

    (ANDROID_RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="ic_launcher_background">#0a0e16</color>\n'
        "</resources>\n"
    )
    (ANDROID_RES / "drawable" / "ic_launcher_background.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#0a0e16" android:pathData="M0,0h108v108h-108z"/>
</vector>
"""
    )

    # Splash screens
    logo = master
    res = ANDROID_RES
    splash_paths = [
        "drawable/splash.png",
        "drawable-port-mdpi/splash.png",
        "drawable-port-hdpi/splash.png",
        "drawable-port-xhdpi/splash.png",
        "drawable-port-xxhdpi/splash.png",
        "drawable-port-xxxhdpi/splash.png",
        "drawable-land-mdpi/splash.png",
        "drawable-land-hdpi/splash.png",
        "drawable-land-xhdpi/splash.png",
        "drawable-land-xxhdpi/splash.png",
        "drawable-land-xxxhdpi/splash.png",
    ]
    for rel in splash_paths:
        p = res / rel
        if p.exists():
            w, h = Image.open(p).size
        else:
            w, h = (480, 800)
        canvas = Image.new("RGBA", (w, h), BG)
        side = int(min(w, h) * 0.28)
        mark = logo.resize((side, side), Image.Resampling.LANCZOS)
        canvas.paste(mark, ((w - side) // 2, (h - side) // 2), mark)
        p.parent.mkdir(parents=True, exist_ok=True)
        canvas.convert("RGB").save(p, "PNG", optimize=True)
        print(f"  splash {rel} {w}x{h}")

    print("Done.")


if __name__ == "__main__":
    main()
