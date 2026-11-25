# Reproductor Coco 🥥📻

Aplicación web / PWA de una sola página (SPA) estilo arcade/cartoon optimizada para **teléfono** y reproducción en **segundo plano** con audio nativo local (`<audio>`), sin dependencias externas de YouTube.

- **Repositorio:** https://github.com/Rattlesnakez/reproductor-coco
- **Web en vivo (GitHub Pages):** https://rattlesnakez.github.io/reproductor-coco/

## Cómo agregar tu audio local

1. Coloca tu archivo de audio comprimido dentro de [`assets/audio/`](assets/audio/README.txt) con el nombre **`cocoteo.mp3`** (`assets/audio/cocoteo.mp3`).
   - También detecta automáticamente `cocoteo.m4a` o `cocoteo.ogg` si no existe `.mp3` (se recomienda `.mp3` por compatibilidad total en iPhone, Android y escritorio).
2. **¿Prefieres varios clips?** Guarda tus clips dentro de `assets/audio/` y agrega sus rutas al arreglo `AUDIO_TRACKS` al inicio de `app.js`.
3. **Límite de 100 MB en GitHub:** Si tu pista dura ~2h 12m y supera los 100 MB, comprímela antes con `ffmpeg` (a 64 kbps queda en ~63 MB):

```bash
ffmpeg -i "tu_audio_original.mp3" -vn -ac 2 -b:a 64k assets/audio/cocoteo.mp3
```

## Reproducción en segundo plano y pantalla bloqueada

- Al usar `<audio>` nativo persistente, el audio continúa reproduciéndose al cambiar de pestaña, minimizar la PWA o bloquear el teléfono.
- Integra la **Media Session API** con título **`Cocoteo FM`**, artista **`Radio en vivo`** y la carátula del logo para controlar **Play**, **Pausa** y **Siguiente** (salto a otro momento aleatorio) directamente desde la pantalla de bloqueo o audífonos.
- Incluye Service Worker (`sw.js`) y `manifest.webmanifest` para instalarla en la pantalla de inicio del celular sin interferir con el streaming por rangos de bytes (`HTTP 206`) del audio.

## Cómo ejecutar en local

```bash
# Recomendado (soporta peticiones HTTP Range / 206 para saltos aleatorios en <audio>)
npx serve .
```

Después abre la URL local que muestre la consola (por ejemplo `http://localhost:3000`).

> **Nota:** `python -m http.server` no incluye cabeceras `Accept-Ranges` / `HTTP 206 Partial Content`, por lo que en desarrollo local con Python el salto aleatorio en `<audio>` puede volver al inicio. En `npx serve .` y en **GitHub Pages** funciona con normalidad.

## Atajos de teclado (computadora)

- **`P`**: Pausar o reanudar la radio (una vez iniciada).
- **`M`**: Silenciar o activar el sonido.
