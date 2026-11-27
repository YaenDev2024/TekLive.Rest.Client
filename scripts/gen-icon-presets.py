"""Genera los íconos preset de TekLive Rest (adaptive icons Android).

Toma la R del icono oficial (blanca sobre verde #2FBF71) y compone variantes
que el usuario puede elegir desde Ajustes. Cada preset produce:
  - mipmap-anydpi-v26/ic_launcher_<preset>.xml   (adaptive-icon)
  - mipmap-<d>/ic_launcher_<preset>_foreground.png (foreground 108dp)
"""

from PIL import Image, ImageDraw
import os

SRC = "src-tauri/icons/icon.png"
RES = "android/app/src/main/res"
DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

# Verde de marca y variantes. El foreground ocupa el 66% central del lienzo
# 108dp: Android recorta el resto en las formas de cada launcher.
PRESETS = {
    "default": {"bg": "#2FBF71", "fg": "#FFFFFF"},
    "dark": {"bg": "#111814", "fg": "#2FBF71"},
    "light": {"bg": "#FFFFFF", "fg": "#2FBF71"},
    "mono": {"bg": "#2FBF71", "fg": "#111814"},
}


def extract_glyph():
    """Máscara alfa de la R (los pixeles blancos del icono original)."""
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    src = im.load()
    dst = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            # Blanco de la R; el fondo es verde, así que basta con exigir
            # los tres canales altos para no capturar antialias del fondo.
            if a > 128 and r > 200 and g > 200 and b > 200:
                dst[x, y] = 255
    return mask


def make_foreground(mask, color, size):
    """Foreground del tamaño pedido con el glifo centrado en la zona segura."""
    fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # El glifo original ocupa ~30% del lienzo de 512: se escala para que quepa
    # cómodo dentro del 66% visible del adaptive icon. 0.72 deja la R con el
    # peso visual del ícono original una vez aplicado el recorte del launcher.
    target = int(size * 0.72)
    glyph = mask.resize((target, target), Image.LANCZOS)
    tinted = Image.new("RGBA", (target, target), color)
    tinted.putalpha(glyph)
    off = (size - target) // 2
    fg.paste(tinted, (off, off), tinted)
    return fg


def main():
    mask = extract_glyph()
    bbox = mask.getbbox()
    print("glifo bbox:", bbox)

    for name, colors in PRESETS.items():
        for dens, scale in DENSITIES.items():
            # 108dp es el tamaño nominal del foreground de un adaptive icon.
            size = int(108 * scale)
            fg = make_foreground(mask, colors["fg"], size)
            outdir = os.path.join(RES, f"mipmap-{dens}")
            os.makedirs(outdir, exist_ok=True)
            path = os.path.join(outdir, f"ic_launcher_{name}_foreground.png")
            fg.save(path, "PNG", optimize=True)
            print("escrito", path, fg.size)

        # XML del adaptive icon: fondo de color plano + foreground propio.
        xmldir = os.path.join(RES, "mipmap-anydpi-v26")
        os.makedirs(xmldir, exist_ok=True)
        xmlpath = os.path.join(xmldir, f"ic_launcher_{name}.xml")
        with open(xmlpath, "w", encoding="utf-8", newline="\n") as f:
            f.write(
                '<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                f'    <background android:drawable="@color/ic_launcher_{name}_background"/>\n'
                f'    <foreground android:drawable="@mipmap/ic_launcher_{name}_foreground"/>\n'
                "</adaptive-icon>\n"
            )
        print("escrito", xmlpath)

        # En API 22-25 no hay adaptive icons: el lanzador necesita un PNG ya
        # recortado. Se parte del mismo foreground y se recorta a la zona
        # visible (centro 66.7%) antes de aplicar la máscara circular.
        for dens, scale in DENSITIES.items():
            legacy = int(48 * scale)
            fg = make_foreground(mask, colors["fg"], legacy * 3)

            comp = Image.alpha_composite(
                Image.new("RGBA", fg.size, colors["bg"]), fg
            )
            side = comp.size[0]
            margin = int(side * (1 - 0.6667) / 2)
            cropped = comp.crop(
                (margin, margin, side - margin, side - margin)
            ).resize((legacy, legacy), Image.LANCZOS)

            circle = Image.new("L", (legacy, legacy), 0)
            ImageDraw.Draw(circle).ellipse((0, 0, legacy - 1, legacy - 1), fill=255)
            rounded = Image.new("RGBA", (legacy, legacy), (0, 0, 0, 0))
            rounded.paste(cropped, (0, 0), circle)

            round_path = os.path.join(
                RES, f"mipmap-{dens}", f"ic_launcher_{name}_round.png"
            )
            rounded.save(round_path, "PNG", optimize=True)
            print("escrito", round_path, rounded.size)

    # Colores de fondo por preset en un solo archivo de valores.
    colorspath = os.path.join(RES, "values", "ic_launcher_presets.xml")
    with open(colorspath, "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        for name, colors in PRESETS.items():
            f.write(f'    <color name="ic_launcher_{name}_background">{colors["bg"]}</color>\n')
        f.write("</resources>\n")
    print("escrito", colorspath)


if __name__ == "__main__":
    main()
