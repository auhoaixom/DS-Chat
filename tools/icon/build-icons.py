#!/usr/bin/env python3
"""从 design/wordmark.png 生成安卓图标（自适应前景层 + 旧式方图 + 圆形图）。

源图是透明底的字标。运行方式：

    python tools/icon/build-icons.py

仅重跑这一个脚本就能改图标，不要手改 res/mipmap-* 里的 png。
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # chat-demo/
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
SRC = os.path.join(ROOT, "design", "wordmark.png")

# 图标占比：字标宽度 / 桌面上的可见图标宽度
WORD_RATIO = 0.74
# 安卓自适应图标：108dp 画布，启动器实际露出的大约是中间 72dp
LAYER_DP = 108
VISIBLE_DP = 72
# 背景色（用户定的是黑底）
BG = (0, 0, 0)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
LEGACY_BASE = 48  # mdpi 下旧式图标边长

# 启动页那张字标：宽度取该密度典型屏宽的多少。
# layer-list 里的 bitmap 不会随屏幕宽度缩放，只能按密度各出一张，所以这里按典型屏宽算比例。
SPLASH_RATIO = 0.46
SPLASH_SCREENS = {"mdpi": 320, "hdpi": 480, "xhdpi": 720, "xxhdpi": 1080, "xxxhdpi": 1440}


def load_wordmark() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    return im.crop(im.getbbox())


def scaled(word: Image.Image, width_px: float) -> Image.Image:
    ratio = width_px / word.size[0]
    h = max(1, int(round(word.size[1] * ratio)))
    return word.resize((max(1, int(round(width_px))), h), Image.LANCZOS)


def foreground(word: Image.Image, canvas_px: int) -> Image.Image:
    """自适应图标的前景层：透明画布，字标按可见区域比例居中。"""
    layer = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    visible_px = canvas_px * VISIBLE_DP / LAYER_DP
    w = scaled(word, visible_px * WORD_RATIO)
    layer.alpha_composite(w, ((canvas_px - w.size[0]) // 2, (canvas_px - w.size[1]) // 2))
    return layer


def legacy(word: Image.Image, size_px: int, round_icon: bool) -> Image.Image:
    """旧式整图：黑底 + 居中的字标；圆形版裁圆。"""
    canvas = Image.new("RGBA", (size_px, size_px), BG + (255,))
    w = scaled(word, size_px * (WORD_RATIO - 0.04 if round_icon else WORD_RATIO))
    canvas.alpha_composite(w, ((size_px - w.size[0]) // 2, (size_px - w.size[1]) // 2))
    if not round_icon:
        return canvas
    mask = Image.new("L", (size_px, size_px), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size_px - 1, size_px - 1], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(0.5, size_px / 96)))
    out = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    out.paste(canvas, (0, 0), mask.point(lambda v: 255 if v > 127 else 0))
    return out


def readme_icon(word: Image.Image, size_px: int = 512, radius_ratio: float = 0.225) -> Image.Image:
    """README 里用的那张：圆角黑底 + 字标，四角透明。

    桌面图标是给启动器画的（方角、留出安全区），直接贴进 README 会出现
    「黑方块看不见边界」的问题：GitHub 深色主题下图标边缘会和背景融成一片。
    所以这里单独出一张圆角、四角透明的版本。
    """
    canvas = Image.new("RGBA", (size_px, size_px), BG + (255,))
    w = scaled(word, size_px * WORD_RATIO)
    canvas.alpha_composite(w, ((size_px - w.size[0]) // 2, (size_px - w.size[1]) // 2))
    mask = Image.new("L", (size_px, size_px), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size_px - 1, size_px - 1], radius=int(size_px * radius_ratio), fill=255
    )
    # 圆角边缘做一点抗锯齿，不然缩放后会看到台阶
    mask = mask.filter(ImageFilter.GaussianBlur(max(0.5, size_px / 256)))
    out = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    out.paste(canvas, (0, 0), mask.point(lambda v: 255 if v > 127 else 0))
    return out


def main() -> int:
    if not os.path.exists(SRC):
        print("missing source:", SRC)
        return 1
    word = load_wordmark()
    print("wordmark", word.size)

    for name, scale in DENSITIES.items():
        folder = os.path.join(RES, f"mipmap-{name}")
        os.makedirs(folder, exist_ok=True)
        fg_px = int(round(LAYER_DP * scale))
        foreground(word, fg_px).save(os.path.join(folder, "ic_launcher_foreground.png"))
        legacy_px = int(round(LEGACY_BASE * scale))
        legacy(word, legacy_px, False).save(os.path.join(folder, "ic_launcher.png"))
        legacy(word, legacy_px, True).save(os.path.join(folder, "ic_launcher_round.png"))
        print(f"  mipmap-{name}: fg {fg_px}px, legacy {legacy_px}px")

    # 启动页字标：每个密度一张，宽度 = 该密度典型屏宽 × SPLASH_RATIO
    for name, screen_w in SPLASH_SCREENS.items():
        folder = os.path.join(RES, f"drawable-{name}")
        os.makedirs(folder, exist_ok=True)
        logo = scaled(word, screen_w * SPLASH_RATIO)
        logo.save(os.path.join(folder, "splash_logo.png"))
        print(f"  drawable-{name}/splash_logo.png {logo.size[0]}x{logo.size[1]}")

    # README 顶部那张（圆角、四角透明），跟着图标一起生成，别手放
    assets = os.path.join(ROOT, "assets")
    os.makedirs(assets, exist_ok=True)
    readme_icon(word).save(os.path.join(assets, "icon.png"))
    print("  assets/icon.png 512px")

    # 自查：模拟启动器把这层塞进 72dp 形状里，看比例对不对
    preview = Image.new("RGBA", (432, 432), (238, 240, 244, 255))
    canvas_px = 576
    fg = foreground(word, canvas_px)
    # 启动器只露出 108dp 里居中的 72dp，先把这块裁出来，再按比例放大到 432px
    pad = int(round(canvas_px * (1 - VISIBLE_DP / LAYER_DP) / 2))
    shown = fg.crop((pad, pad, canvas_px - pad, canvas_px - pad)).resize((432, 432), Image.LANCZOS)
    tile = Image.new("RGBA", (432, 432), BG + (255,))
    mask = Image.new("L", (432, 432), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 431, 431], radius=120, fill=255)
    tile.paste(tile, (0, 0), mask)
    tile.alpha_composite(shown, (0, 0))
    preview.alpha_composite(tile)
    preview.save(os.path.join(HERE, "preview.png"))
    print("preview ->", os.path.join(HERE, "preview.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
