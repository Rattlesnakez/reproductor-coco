Coloca aquí tu archivo de audio local para Reproductor Coco:

1. Archivo único (recomendado):
   Guarda tu archivo comprimido como:
     assets/audio/cocoteo.mp3
   (También se detectan automáticamente cocoteo.m4a o cocoteo.ogg como respaldo si no existe cocoteo.mp3; .mp3 funciona en iPhone/iOS, Android y computadora.)

2. Múltiples clips (opcional):
   Si prefieres dividir la radio en varios archivos cortos, guárdalos en esta carpeta (por ejemplo clip-1.mp3, clip-2.mp3) y agrega sus rutas al arreglo AUDIO_TRACKS al inicio de app.js.

3. Límite de tamaño en GitHub (100 MB):
   Si vas a subir el audio a GitHub y pesa más de 100 MB, comprímelo antes con ffmpeg (para ~2h 12m a 64 kbps queda en ~63 MB):
     ffmpeg -i "tu_audio_original.mp3" -vn -ac 2 -b:a 64k cocoteo.mp3
