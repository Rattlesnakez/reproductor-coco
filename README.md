# Reproductor Coco 🥥📻

Aplicación web / PWA de una sola página (SPA) estilo arcade/cartoon optimizada para **teléfono** y reproducción en **segundo plano** con audio nativo (`<audio>`), usando una URL directa de audio/stream o archivos locales en `assets/audio/`.

- **Repositorio:** https://github.com/Rattlesnakez/reproductor-coco
- **Web en vivo (GitHub Pages):** https://rattlesnakez.github.io/reproductor-coco/

## Cómo configurar tu URL de audio o stream

Puedes conectar cualquier archivo directo (`.mp3`, `.m4a`, `.ogg`) o stream de radio en vivo de 3 formas:

1. **Desde la propia app (botón 🔗):** Toca el ícono discreto de enlace debajo del reproductor, pega la URL y pulsa **Guardar y sonar** (se guarda automáticamente en el navegador/teléfono con `localStorage`).
2. **En el código o por parámetro web:**
   - Para dejarla fija para todos los dispositivos, pega la URL en `DEFAULT_AUDIO_URL` al inicio de [`app.js`](app.js).
   - O abre la web pasando `?url=https://tu-servidor.com/cocoteo.mp3`.
3. **Archivo local en el repositorio:** Si prefieres alojar el archivo dentro de [`assets/audio/`](assets/audio/README.txt), guárdalo como `assets/audio/cocoteo.mp3` (o lista varios clips en `AUDIO_TRACKS` dentro de `app.js`).

## Reproducción en segundo plano y pantalla de bloqueo

- Con una URL directa de audio/stream (sin reproductores externos de video), el `<audio>` nativo **no se detiene** al cambiar de pestaña, minimizar la PWA o bloquear la pantalla del celular.
- La **Media Session API** bloquea la tarjeta multimedia del teléfono al nombre **`Cocoteo FM`** / **`Radio en vivo`** y al ícono oficial de la aplicación (`icon-192.png` / `icon-512.png`) en lugar de mostrar portadas de video o nombres de archivo, junto con controles de **Play**, **Pausa** y **Siguiente** (salto a otro momento aleatorio).
- Incluye Service Worker (`sw.js`) y `manifest.webmanifest` para instalarla en la pantalla de inicio sin interferir con el streaming ni con peticiones `HTTP 206 Partial Content`.

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
