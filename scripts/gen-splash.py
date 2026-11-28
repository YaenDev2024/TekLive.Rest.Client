"""Genera el splash de Android con la alita de Crazzy Wings.

Reemplaza los PNG genericos de Capacitor (el rayo azul sobre blanco) por la
marca del cliente sobre el fondo de la app. Salidas:

  - drawable/splash.png + drawable-{port,land}-{mdpi..xxxhdpi}/splash.png
    (splash heredado, el que realmente se ve en Android < 12)
  - drawable/splash_mark.png
    (icono del splash de Android 12+, via windowSplashScreenAnimatedIcon)
  - values/colors.xml
    (splash_background con el fondo de marca, ya como recurso de color)

El arte fuente es el icono de 1024 px del sistema legacy: es la version de
mayor resolucion de la alita y ya viene con transparencia, asi que se puede
escalar sin pixelar hasta las pantallas xxxhdpi.

Uso: python scripts/gen-splash.py
"""

from PIL import Image
import os

SRC = (
    "C:/Users/tomacost/source/personal/crazzyWings/ios/Runner/"
    "Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png"
)
RES = os.path.join("android", "app", "src", "main", "res")

# Fondo de marca: el mismo --bg del design system (src/style.css).
BACKGROUND = (0x17, 0x17, 0x17)

# El splash heredado dibuja el bitmap centrado a su tamano nativo, asi que el
# lienzo de cada densidad es la pantalla completa y el logo va escalado a una
# fraccion de ella. 0.30 deja el logo grande pero sin llegar a los bordes en
# pantallas 20:9 (donde el PNG recortado por aspect-ratio se ve igual).
LOGO_RATIO = 0.30

# (carpeta, ancho, alto) - mismos tamanos que traia Capacitor para no cambiar
# el escalado en ningun dispositivo.
CANVASES = [
    ("drawable", 480, 320),
    ("drawable-port-mdpi", 320, 480),
    ("drawable-port-hdpi", 480, 800),
    ("drawable-port-xhdpi", 720, 1280),
    ("drawable-port-xxhdpi", 960, 1600),
    ("drawable-port-xxxhdpi", 1280, 1920),
    ("drawable-land-mdpi", 480, 320),
    ("drawable-land-hdpi", 800, 480),
    ("drawable-land-xhdpi", 1280, 720),
    ("drawable-land-xxhdpi", 1600, 960),
    ("drawable-land-xxxhdpi", 1920, 1280),
]

# Android 12+ dibuja el icono del splash en una caja de 288dp. El arte se
# emite por densidad con ese tamano intrinseco (288dp) para que el sistema
# nunca tenga que ampliarlo: en xxxhdpi son 1152 px. El alita se queda dentro
# del ~62% central, que es el area que sobrevive a cualquier mascara.
MARK_DP = 288
MARK_FILL = 0.62
MARK_DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def load_mark():
    """Alita recortada a su caja util, con transparencia limpia."""
    im = Image.open(SRC).convert("RGBA")
    im = unpremultiply(im)
    bbox = im.getbbox()
    if not bbox:
        raise SystemExit("El arte fuente no tiene pixeles visibles")
    return im.crop(bbox)


def unpremultiply(im):
    """Quita el matte negro de los bordes semitransparentes.

    El PNG del legacy viene premultiplicado sobre negro: donde el alfa es
    parcial el color esta oscurecido, y al componerlo sobre el fondo oscuro
    del splash eso no se nota, pero sobre cualquier fondo claro deja un halo
    gris. Se divide el color por el alfa para recuperar el naranja real.
    """
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
            elif a < 255:
                f = 255.0 / a
                px[x, y] = (
                    min(255, round(r * f)),
                    min(255, round(g * f)),
                    min(255, round(b * f)),
                    a,
                )
    return im


def fit(mark, box):
    """Escala el alita para que quepa en `box` sin deformarse."""
    ratio = min(box[0] / mark.width, box[1] / mark.height)
    size = (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio)))
    return mark.resize(size, Image.LANCZOS)


def compose(canvas_w, canvas_h, mark):
    canvas = Image.new("RGBA", (canvas_w, canvas_h), BACKGROUND + (255,))
    # El splash heredado se muestra con gravity=center y sin escalar: se
    # reserva el 30% del lado menor para el logo en ambas orientaciones.
    box = (round(min(canvas_w, canvas_h) * LOGO_RATIO),) * 2
    logo = fit(mark, box)
    pos = ((canvas_w - logo.width) // 2, (canvas_h - logo.height) // 2)
    canvas.alpha_composite(logo, pos)
    return canvas


def main():
    mark = load_mark()

    for folder, w, h in CANVASES:
        target_dir = os.path.join(RES, folder)
        os.makedirs(target_dir, exist_ok=True)
        out = os.path.join(target_dir, "splash.png")
        compose(w, h, mark).convert("RGB").save(out, "PNG", optimize=True)
        print(f"{out}  {w}x{h}")

    # Icono de Android 12+: lienzo cuadrado transparente con el alita dentro
    # del area segura (el sistema aplica la mascara circular).
    for density, scale in MARK_DENSITIES.items():
        px = round(MARK_DP * scale)
        out_dir = os.path.join(RES, f"drawable-{density}")
        os.makedirs(out_dir, exist_ok=True)
        square = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        logo = fit(mark, (round(px * MARK_FILL),) * 2)
        square.alpha_composite(
            logo, ((px - logo.width) // 2, (px - logo.height) // 2)
        )
        mark_path = os.path.join(out_dir, "splash_mark.png")
        square.save(mark_path, "PNG", optimize=True)
        print(f"{mark_path}  {px}x{px}")

    write_colors()


def write_colors():
    """splash_background como recurso de color (lo usa el tema v31)."""
    out = os.path.join(RES, "values", "colors.xml")
    hex_bg = "#%02X%02X%02X" % BACKGROUND
    body = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <!-- Fondo del splash: mismo color de fondo del design system. -->\n'
        f'    <color name="splash_background">{hex_bg}</color>\n'
        "</resources>\n"
    )
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"{out}  {hex_bg}")


if __name__ == "__main__":
    main()
