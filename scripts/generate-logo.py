#!/usr/bin/env python3
"""
Project Cost Tracker logo — geometric cost peak (bars + rising trajectory).
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

BG_TOP = (20, 26, 40, 255)
BG_BOT = (7, 10, 16, 255)
TEAL = (45, 212, 191, 255)
TEAL_HI = (94, 234, 212, 255)
TEAL_DIM = (15, 118, 110, 255)
AMBER = (251, 146, 60, 255)
GOLD = (251, 191, 36, 255)
WHITE = (255, 255, 255, 255)
RAIL = (148, 163, 184, 70)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(c1: tuple, c2: tuple, t: float) -> tuple:
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(4))


def rounded_mask(size: int, radius: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(radius), fill=255)
    return m


def draw_thick_polyline(
    draw: ImageDraw.ImageDraw,
    pts: list[tuple[float, float]],
    width: float,
    color: tuple,
) -> None:
    if len(pts) < 2:
        return
    # Draw as overlapping disks + segments for smooth thick stroke
    r = width / 2
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        draw.line([(x0, y0), (x1, y1)], fill=color, width=max(1, int(width)))
        draw.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=color)
    x, y = pts[-1]
    draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def draw_logo(size: int, *, with_app_bg: bool = True) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    if with_app_bg:
        base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        bd = ImageDraw.Draw(base)
        # Vertical gradient bg
        for y in range(s):
            t = y / max(1, s - 1)
            c = lerp_color(BG_TOP, BG_BOT, t)
            bd.line([(0, y), (s, y)], fill=c)
        # Ambient amber glow top-right
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gx, gy = int(s * 0.72), int(s * 0.28)
        for i in range(18, 0, -1):
            a = int(28 * (i / 18))
            r = int(s * 0.38 * (i / 18))
            gd.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(251, 146, 60, a))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=max(2, s // 16)))
        base = Image.alpha_composite(base, glow)

        mask = rounded_mask(s, s * 0.22)
        rounded = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        rounded.paste(base, (0, 0))
        img = Image.composite(rounded, img, mask)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle(
            [s * 0.02, s * 0.02, s * 0.98 - 1, s * 0.98 - 1],
            radius=int(s * 0.20),
            outline=(94, 234, 212, 55),
            width=max(1, s // 90),
        )
    else:
        d = ImageDraw.Draw(img)

    # Base rail
    y_rail = s * 0.76
    d.line(
        [(s * 0.18, y_rail), (s * 0.82, y_rail)],
        fill=RAIL,
        width=max(1, s // 64),
    )

    # Bars
    bar_w = s * 0.11
    gap = s * 0.045
    x0 = s * 0.22
    bases = y_rail - s * 0.01
    heights = [s * 0.19, s * 0.29, s * 0.40]
    colors = [
        (*TEAL_DIM[:3], 210),
        (*TEAL[:3], 235),
        (*TEAL_HI[:3], 255),
    ]
    for i, (h, col) in enumerate(zip(heights, colors)):
        x = x0 + i * (bar_w + gap)
        d.rounded_rectangle(
            [x, bases - h, x + bar_w, bases],
            radius=max(2, int(s * 0.03)),
            fill=col,
        )

    # Peak trajectory
    pts = [
        (s * 0.20, s * 0.66),
        (s * 0.34, s * 0.57),
        (s * 0.49, s * 0.44),
        (s * 0.64, s * 0.29),
        (s * 0.78, s * 0.19),
    ]
    # Soft under-glow on path
    glow_line = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gld = ImageDraw.Draw(glow_line)
    draw_thick_polyline(gld, pts, width=s * 0.10, color=(45, 212, 191, 70))
    glow_line = glow_line.filter(ImageFilter.GaussianBlur(radius=max(1, s // 40)))
    img = Image.alpha_composite(img, glow_line)
    d = ImageDraw.Draw(img)

    # Gradient-ish multi stroke
    draw_thick_polyline(d, pts, width=s * 0.075, color=TEAL)
    # Amber end of stroke
    draw_thick_polyline(d, pts[2:], width=s * 0.072, color=GOLD)
    draw_thick_polyline(d, pts[3:], width=s * 0.068, color=AMBER)
    # Highlight
    draw_thick_polyline(d, pts[:4], width=s * 0.022, color=(255, 255, 255, 90))

    # Peak node
    px, py = pts[-1]
    r = s * 0.082
    d.ellipse([px - r * 1.35, py - r * 1.35, px + r * 1.35, py + r * 1.35], fill=(251, 146, 60, 50))
    d.ellipse([px - r, py - r, px + r, py + r], fill=AMBER)
    d.ellipse(
        [px - r, py - r, px + r, py + r],
        outline=(255, 255, 255, 90),
        width=max(1, s // 90),
    )
    # Specular
    sr = r * 0.28
    d.ellipse(
        [px - r * 0.45 - sr, py - r * 0.4 - sr, px - r * 0.45 + sr, py - r * 0.4 + sr],
        fill=(255, 255, 255, 170),
    )

    return img


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024}KB)")


def write_android_mipmaps(master: Image.Image) -> None:
    if not ANDROID_RES.exists():
        print("  (no android/res — skip mipmaps)")
        return
    # launcher sizes
    dens = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, sz in dens.items():
        out = ANDROID_RES / folder
        out.mkdir(parents=True, exist_ok=True)
        icon = master.resize((sz, sz), Image.Resampling.LANCZOS)
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            save_png(icon, out / name)


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    print("Generating Project Cost Tracker logo…")
    master = draw_logo(1024, with_app_bg=True)
    save_png(master, PUBLIC / "logo.png")
    save_png(master.resize((512, 512), Image.Resampling.LANCZOS), PUBLIC / "pwa-512.png")
    save_png(master.resize((192, 192), Image.Resampling.LANCZOS), PUBLIC / "pwa-192.png")
    save_png(master.resize((180, 180), Image.Resampling.LANCZOS), PUBLIC / "apple-touch-icon.png")

    # Simple SVG favicon (inline mark)
    favicon = PUBLIC / "favicon.svg"
    favicon.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="15" fill="#0b101a"/>
  <rect x="14" y="36" width="7" height="12.5" rx="2" fill="#0f766e"/>
  <rect x="24" y="30" width="7" height="18.5" rx="2" fill="#2dd4bf"/>
  <rect x="34" y="23" width="7" height="25.5" rx="2" fill="#5eead4"/>
  <path d="M13 42.5 L22 36.5 L31.5 28.5 L41 18.5 L50 12" stroke="#5eead4" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M41 18.5 L50 12" stroke="#fb923c" stroke-width="3.4" stroke-linecap="round"/>
  <circle cx="50" cy="12" r="5.2" fill="#fb923c"/>
</svg>
""",
        encoding="utf-8",
    )
    print(f"  wrote {favicon.relative_to(ROOT)}")

    write_android_mipmaps(master)
    print("Done.")


if __name__ == "__main__":
    main()
