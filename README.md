# Reproductor Coco 🥥📻

Aplicación web de una sola página (SPA) estilo arcade/cartoon optimizada para **teléfono** y computadora, conectada al stream de **COCOTEO FM GTA 6 RADIO FULL EXTENDED** mediante la YouTube IFrame Player API.

- **Repositorio:** https://github.com/Rattlesnakez/reproductor-coco
- **Web en vivo (GitHub Pages):** https://rattlesnakez.github.io/reproductor-coco/

## Optimizada para teléfono

- **Ergonomía táctil:** Botón principal ancho para usar con el pulgar y controles secundarios de `50×50 px`, sin estados hover atascados ni rebote de scroll (`overscroll-behavior: none`, `touch-action: manipulation`).
- **Pantalla completa adaptativa:** Se ajusta tanto en teléfonos verticales (`360×640`, `390×844`) como en horizontal (`844×390`) respetando los márgenes seguros (`env(safe-area-inset-*)`).
- **Vibración háptica:** Ligero pulso táctil (`navigator.vibrate`) al sintonizar un nuevo momento aleatorio.
- **Controles de pantalla bloqueada:** Integración con la **Media Session API** para pausar, reanudar o cambiar a otro momento aleatorio desde la notificación o audífonos.
- **Instalable como app (PWA):** Incluye `manifest.webmanifest` e ícono para añadirlo directamente a la pantalla de inicio en Android/iOS.

## Logo

El logo oficial **`logo.png`** ya está incluido en esta carpeta con fondo transparente. Si en algún momento deseas cambiarlo, basta con reemplazar `logo.png` junto a `index.html` (la app conserva además un SVG de respaldo por si faltara la imagen).

## Cómo ejecutar en local

La API de YouTube requiere abrir la página desde un servidor HTTP (no directamente como `file://`). Desde esta carpeta ejecuta:

```bash
# Con Python
python -m http.server 8000
```

o

```bash
# Con Node.js
npx serve .
```

Después abre `http://localhost:8000` (o el puerto que indique la consola) en tu navegador.

## Atajos de teclado (computadora)

- **`P`**: Pausar o reanudar la radio (una vez iniciada).
- **`M`**: Silenciar o activar el sonido.
