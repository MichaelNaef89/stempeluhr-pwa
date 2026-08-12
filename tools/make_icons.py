"""Erzeugt die PWA-Icons (dunkle Stempeluhr mit Amber-Zeigern).

    python tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

BG = (24, 27, 30)
RING = (232, 163, 61)
FACE = (34, 38, 42)
TICK = (138, 141, 146)
HAND = (232, 163, 61)
TEAL = (79, 184, 168)

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # Supersampling für weiche Kanten


def clock_face(size, inset_ratio, rounded):
    """Zeichnet das Zifferblatt auf eine Fläche der Kantenlänge `size`."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, s - 1, s - 1], fill=BG)

    c = s / 2
    r = s * inset_ratio
    ring_w = max(2, int(s * 0.035))

    d.ellipse([c - r, c - r, c + r, c + r], fill=FACE, outline=RING, width=ring_w)

    # Stundenmarken
    import math

    for i in range(12):
        a = math.radians(i * 30 - 90)
        r1, r2 = r * 0.80, r * 0.92
        w = max(2, int(s * (0.020 if i % 3 == 0 else 0.011)))
        col = RING if i % 3 == 0 else TICK
        d.line(
            [c + r1 * math.cos(a), c + r1 * math.sin(a), c + r2 * math.cos(a), c + r2 * math.sin(a)],
            fill=col,
            width=w,
        )

    # Zeiger auf 10:10 – wirkt auf kleinen Grössen am ruhigsten
    def hand(angle_deg, length, width, color):
        a = math.radians(angle_deg - 90)
        d.line(
            [c, c, c + r * length * math.cos(a), c + r * length * math.sin(a)],
            fill=color,
            width=max(2, int(s * width)),
        )

    hand(305, 0.46, 0.042, HAND)  # Stundenzeiger
    hand(55, 0.66, 0.032, TEAL)   # Minutenzeiger

    pin = s * 0.030
    d.ellipse([c - pin, c - pin, c + pin, c + pin], fill=RING)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    for size in (192, 512):
        clock_face(size, 0.36, rounded=True).save(OUT / f"icon-{size}.png")

    # Maskable: Motiv kleiner, damit der Safe-Zone-Kreis nichts abschneidet
    m = Image.new("RGBA", (512, 512), BG)
    m.paste(clock_face(512, 0.29, rounded=False), (0, 0))
    m.save(OUT / "icon-maskable-512.png")

    # Favicon
    clock_face(64, 0.38, rounded=True).save(OUT / "favicon.png")

    for f in sorted(OUT.iterdir()):
        print(f"{f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
