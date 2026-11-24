#!/usr/bin/env python3
"""从设计图（纯色底的 jpg）里抠出透明底字标。

源图是 jpg，边缘像素是字形色和白底按覆盖率混出来的。直接把"离白底多远"
当 alpha 会把大半圈抗锯齿像素判成不透明，于是留下一圈发白的硬边（毛边）。
这里按正规的反混合来做：

1. 中值滤波压掉 jpg 块噪声；
2. 找出确定被字形完全覆盖的"核心"像素，把它们的颜色往边缘扩散（bleed），
   得到每个像素的"字形本色"；
3. 用最小二乘解覆盖率：alpha = <白底-p, 白底-fg> / |白底-fg|²，
   这样半透明边缘像素的颜色是字形色，不再掺白。

用法（在 chat-demo 目录下）：

    python tools/icon/extract-wordmark.py [源图路径]

默认读 ../icon-images/白底图标.jpg，输出 design/wordmark.png 与 src/assets/wordmark.png。
"""

import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # chat-demo/
DEFAULT_SRC = os.path.join(os.path.dirname(ROOT), "icon-images", "白底图标.jpg")
OUT_DESIGN = os.path.join(ROOT, "design", "wordmark.png")
OUT_APP = os.path.join(ROOT, "src", "assets", "wordmark.png")

BG = np.array([255.0, 255.0, 255.0], dtype=np.float32)
CORE_DIFF = 0.70  # 与白底差异超过这个比例，认为字形完全覆盖
ALPHA_FLOOR = 0.03


def spread_colors(arr: np.ndarray, core: np.ndarray, iterations: int = 40) -> np.ndarray:
    """把核心像素的颜色往外扩散，让每个像素都有一份"字形本色" """
    h, w, _ = arr.shape
    known = core.copy()
    color = arr.copy()
    color[~known] = 0.0
    offsets = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
    for _ in range(iterations):
        if known.all():
            break
        acc = np.zeros_like(color)
        cnt = np.zeros((h, w), dtype=np.float32)
        for dy, dx in offsets:
            k = np.roll(known, (dy, dx), axis=(0, 1))
            acc += np.roll(color, (dy, dx), axis=(0, 1)) * k[..., None]
            cnt += k.astype(np.float32)
        fill = (~known) & (cnt > 0)
        if not fill.any():
            break
        color[fill] = acc[fill] / cnt[fill][:, None]
        known = known | fill
    color[~known] = BG
    return color


def unmatte(arr: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """最小二乘解覆盖率：把每个像素看成 字形色 与 白底 的线性混合"""
    bg_minus_p = BG - arr
    bg_minus_fg = BG - fg
    denom = (bg_minus_fg * bg_minus_fg).sum(axis=2)
    num = (bg_minus_p * bg_minus_fg).sum(axis=2)
    alpha = np.where(denom > 1e-3, num / np.maximum(denom, 1e-3), 0.0)
    return np.clip(alpha, 0.0, 1.0)


def main() -> int:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        print("找不到源图:", src)
        return 1

    rgb = Image.open(src).convert("RGB").filter(ImageFilter.MedianFilter(3))
    arr = np.asarray(rgb).astype(np.float32)

    diff = np.abs(arr - BG).max(axis=2) / 255.0
    core = diff > CORE_DIFF
    fg = spread_colors(arr, core)
    alpha = unmatte(arr, fg)
    alpha[alpha < ALPHA_FLOOR] = 0.0

    alpha_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    # 极轻微平滑，消掉 jpg 造成的锯齿台阶（不超过 1px）
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(0.6))

    out = Image.fromarray(
        np.dstack([np.clip(fg, 0, 255), np.asarray(alpha_img)]).astype(np.uint8), "RGBA"
    )
    out = out.crop(out.getbbox())
    for path in (OUT_DESIGN, OUT_APP):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        out.save(path)
        print("写出", path, out.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
