from __future__ import annotations

import re
from pathlib import Path

import vtracer
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "chibi-reference.png"
OUTPUT = HERE / "vector-candidates"
VIOLET = "#6C63FF"

# The generated reference is a 3 by 2 contact sheet separated by transparent
# gutters. This order matches the category order used when the sheet was made.
CELLS = (
    ("root", (0, 0, 341, 341)),
    ("anime", (342, 0, 683, 341)),
    ("playlists", (683, 0, 1024, 341)),
    ("liked", (0, 342, 341, 683)),
    ("search", (342, 342, 683, 683)),
    ("fallback", (683, 342, 1024, 683)),
)


def make_trace_input(source: Image.Image, bounds: tuple[int, int, int, int]) -> Image.Image:
    crop = source.crop(bounds).convert("RGBA")
    # Preserve source antialiasing; thresholding before enlargement created
    # visible source-pixel stair steps in the first candidate set.
    white = Image.new("RGBA", crop.size, "white")
    grayscale = Image.alpha_composite(white, crop).convert("L")
    grayscale = ImageOps.autocontrast(grayscale, cutoff=(0.2, 0.2))
    ink_mask = grayscale.point(lambda value: 255 if value < 232 else 0)
    bbox = ink_mask.getbbox()
    if bbox is None:
        raise RuntimeError(f"No traceable artwork found in cell {bounds}")

    ink = grayscale.crop(bbox)
    side = max(ink.size)
    padding = max(12, round(side * 0.10))
    canvas_side = side + padding * 2
    canvas = Image.new("L", (canvas_side, canvas_side), 255)
    canvas.paste(ink, ((canvas_side - ink.width) // 2, (canvas_side - ink.height) // 2))
    # Supersample before tracing and lightly blur the coverage field so spline
    # fitting follows smooth contours rather than individual raster pixels.
    return canvas.resize((2048, 2048), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(1.35))


def recolor_svg(path: Path) -> None:
    svg = path.read_text(encoding="utf-8")
    if path.stem == "search":
        # Remove the generated, disconnected half-circle at the far-right edge.
        svg = re.sub(
            r'<path d="M(1[89]\d{2}),[^\"]*"/>',
            lambda match: "" if int(match.group(1)) >= 1800 and len(match.group(0)) < 1500 else match.group(0),
            svg,
        )
    svg = re.sub(r'fill="(?:#000000|black)"', f'fill="{VIOLET}"', svg, flags=re.IGNORECASE)
    svg = re.sub(r'fill="rgb\(0,\s*0,\s*0\)"', f'fill="{VIOLET}"', svg, flags=re.IGNORECASE)
    svg = re.sub(r"<svg\b", '<svg viewBox="0 0 2048 2048" role="img" data-character="ongaku-mascot"', svg, count=1)
    path.write_text(svg, encoding="utf-8", newline="\n")


def render_preview(svg_path: Path, png_path: Path, size: int) -> None:
    # Sharp is already a production dependency and gives the same renderer that
    # Anime Ongaku uses for its legacy Sonos PNG fallback.
    node = HERE.parents[2] / "node_modules" / "sharp"
    script = HERE / "render_vector_candidate.mjs"
    if not script.exists():
        script.write_text(
            "import sharp from 'sharp';\n"
            "const [input, output, size] = process.argv.slice(2);\n"
            "await sharp(input).resize(Number(size), Number(size), { fit: 'contain' })"
            ".png().toFile(output);\n",
            encoding="utf-8",
            newline="\n",
        )
    del node  # Module resolution comes from server/node_modules.
    import subprocess

    subprocess.run(
        ["node", str(script), str(svg_path), str(png_path), str(size)],
        cwd=HERE.parents[1],
        check=True,
    )


def contact_sheet(paths: list[tuple[str, Path]], size: int, output: Path) -> None:
    tile = size + 32
    sheet = Image.new("RGB", (tile * 3, (tile + 24) * 2), "#F2F3F5")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=16)
    for index, (name, path) in enumerate(paths):
        icon = Image.open(path).convert("RGBA")
        left = (index % 3) * tile + 16
        top = (index // 3) * (tile + 24) + 16
        sheet.alpha_composite(icon, (left, top)) if sheet.mode == "RGBA" else sheet.paste(icon, (left, top), icon)
        label_box = draw.textbbox((0, 0), name, font=font)
        label_width = label_box[2] - label_box[0]
        draw.text((left + (size - label_width) / 2, top + size + 4), name, fill="#27272A", font=font)
    sheet.save(output)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE)
    previews_290: list[tuple[str, Path]] = []
    previews_40: list[tuple[str, Path]] = []

    for name, bounds in CELLS:
        trace_input = make_trace_input(source, bounds)
        input_path = OUTPUT / f"{name}-trace-input.png"
        svg_path = OUTPUT / f"{name}.svg"
        preview_290 = OUTPUT / f"{name}-290.png"
        preview_40 = OUTPUT / f"{name}-40.png"
        trace_input.save(input_path)
        tracer = vtracer.Config(
            clustering="bw",
            hierarchical="cutout",
            mode="spline",
            filter_speckle=24,
            corner_threshold=42,
            length_threshold=8.0,
            max_iterations=10,
            splice_threshold=35,
            simplify=2.25,
            path_precision=2,
            optimize=2,
            binary_threshold=205,
        )
        tracer.convert_file(str(input_path), str(svg_path))
        recolor_svg(svg_path)
        render_preview(svg_path, preview_290, 290)
        render_preview(svg_path, preview_40, 40)
        previews_290.append((name, preview_290))
        previews_40.append((name, preview_40))

    contact_sheet(previews_290, 290, OUTPUT / "contact-sheet-290.png")
    contact_sheet(previews_40, 40, OUTPUT / "contact-sheet-40.png")
    print(OUTPUT)


if __name__ == "__main__":
    main()
