"""Generate Open Graph images for blog posts and the main site."""
from __future__ import annotations

import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1200
HEIGHT = 630
BACKGROUND_TOP = (15, 23, 42)
BACKGROUND_BOTTOM = (30, 64, 175)
TEXT_COLOR = (248, 250, 252)
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SMALL_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

ROOT = Path(__file__).resolve().parents[1]
BLOG_IMAGES = ROOT / "blog" / "images"
BLOG_IMAGES.mkdir(parents=True, exist_ok=True)


def _gradient_background() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND_TOP)
    pixels = image.load()
    for y in range(HEIGHT):
        ratio = y / (HEIGHT - 1)
        r = int(BACKGROUND_TOP[0] + (BACKGROUND_BOTTOM[0] - BACKGROUND_TOP[0]) * ratio)
        g = int(BACKGROUND_TOP[1] + (BACKGROUND_BOTTOM[1] - BACKGROUND_TOP[1]) * ratio)
        b = int(BACKGROUND_TOP[2] + (BACKGROUND_BOTTOM[2] - BACKGROUND_TOP[2]) * ratio)
        for x in range(WIDTH):
            pixels[x, y] = (r, g, b)
    return image


def _draw_title(draw: ImageDraw.ImageDraw, text: str, *, top: int = 180) -> None:
    font = ImageFont.truetype(FONT_PATH, 70)
    lines = textwrap.wrap(text, width=24)
    y = top
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        draw.text(((WIDTH - bbox[2]) / 2, y), line, font=font, fill=TEXT_COLOR)
        y += bbox[3] - bbox[1] + 10


def _draw_footer(draw: ImageDraw.ImageDraw, text: str) -> None:
    font = ImageFont.truetype(SMALL_FONT_PATH, 32)
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text((WIDTH / 2 - bbox[2] / 2, HEIGHT - 120), text, font=font, fill=TEXT_COLOR)
    pill_text = "andrewconcepcion.com"
    pill_font = ImageFont.truetype(SMALL_FONT_PATH, 26)
    pill_bbox = draw.textbbox((0, 0), pill_text, font=pill_font)
    padding_x, padding_y = 20, 10
    pill_width = pill_bbox[2] - pill_bbox[0] + padding_x * 2
    pill_height = pill_bbox[3] - pill_bbox[1] + padding_y * 2
    pill_x = WIDTH / 2 - pill_width / 2
    pill_y = 70
    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_width, pill_y + pill_height],
        radius=pill_height / 2,
        fill=(15, 118, 110),
    )
    draw.text(
        (WIDTH / 2 - pill_bbox[2] / 2, pill_y + padding_y / 2),
        pill_text,
        font=pill_font,
        fill=TEXT_COLOR,
    )


def _save_image(path: Path, title: str) -> None:
    image = _gradient_background()
    draw = ImageDraw.Draw(image)
    _draw_footer(draw, title)
    _draw_title(draw, title)
    image.save(path, format="PNG")


def create_post_images(posts_path: Path) -> None:
    posts = json.loads(posts_path.read_text())
    for post in posts:
        slug = post["slug"]
        title = post["title"]
        target = BLOG_IMAGES / f"og-{slug}.png"
        _save_image(target, title)
        print(f"Generated {target.relative_to(ROOT)}")


def create_site_image() -> None:
    target = ROOT / "images"
    target.mkdir(exist_ok=True)
    path = target / "og-portfolio.png"
    _save_image(path, "Andrew V. Concepcion — Mobile Developer")
    print(f"Generated {path.relative_to(ROOT)}")


def create_blog_home_image() -> None:
    path = BLOG_IMAGES / "og-blog-home.png"
    _save_image(path, "Field Notes — Blog")
    print(f"Generated {path.relative_to(ROOT)}")


def main() -> None:
    posts_path = ROOT / "blog" / "posts.json"
    create_post_images(posts_path)
    create_site_image()
    create_blog_home_image()


if __name__ == "__main__":
    main()
