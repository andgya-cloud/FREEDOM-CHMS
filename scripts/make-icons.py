"""Draws the app icons (navy tile, gold flame, green base) into public/. Run: npm run icons"""
from PIL import Image, ImageDraw

NAVY, GOLD, GREEN, WHITE = (20, 40, 75), (212, 160, 23), (31, 122, 77), (255, 255, 255)

def draw(size, padding_ratio, rounded):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0) if rounded else NAVY)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=NAVY)
    p = size * padding_ratio
    w = size - 2 * p
    cx = size / 2
    # flame
    flame = [
        (cx, p + w * 0.05),
        (cx + w * 0.26, p + w * 0.42),
        (cx + w * 0.20, p + w * 0.66),
        (cx, p + w * 0.74),
        (cx - w * 0.20, p + w * 0.66),
        (cx - w * 0.26, p + w * 0.42),
    ]
    d.polygon(flame, fill=GOLD)
    inner = [
        (cx, p + w * 0.36),
        (cx + w * 0.11, p + w * 0.54),
        (cx, p + w * 0.68),
        (cx - w * 0.11, p + w * 0.54),
    ]
    d.polygon(inner, fill=WHITE)
    d.rounded_rectangle([cx - w * 0.32, p + w * 0.80, cx + w * 0.32, p + w * 0.92], radius=int(w * 0.05), fill=GREEN)
    return img

draw(192, 0.14, True).save('public/pwa-192.png')
draw(512, 0.14, True).save('public/pwa-512.png')
draw(512, 0.24, False).save('public/pwa-maskable-512.png')
draw(180, 0.16, False).convert('RGB').save('public/apple-touch-icon.png')
print('icons written')
