(() => {
  'use strict';

  const VIDEO_ID = 'JO0HDMeifKU';
  const MIN_SECOND = 5;        // 00:05
  const MAX_SECOND = 7890;     // 02:11:30
  const MIN_JUMP_GAP = 90;     // Evita caer demasiado cerca del punto anterior
  const SEEK_GUARD_WINDOW_MS = 6000;
  const SEEK_DRIFT_TOLERANCE_SEC = 8;

  const brandLogo = document.getElementById('brand-logo');
  const logoFallback = document.getElementById('logo-fallback');
  const logoInner = document.getElementById('logo-inner');
  const tuneBtn = document.getElementById('tune-btn');
  const tuneBtnLabel = document.getElementById('tune-btn-label');
  const sparkleLayer = document.getElementById('sparkle-layer');
  const statusText = document.getElementById('status-text');
  const pauseBtn = document.getElementById('pause-btn');
  const muteBtn = document.getElementById('mute-btn');
  const iconPause = pauseBtn.querySelector('.icon-pause');
  const iconPlay = pauseBtn.querySelector('.icon-play');
  const iconSound = muteBtn.querySelector('.icon-sound');
  const iconMuted = muteBtn.querySelector('.icon-muted');

  let player = null;
  let isPlayerReady = false;
  let hasStarted = false;
  let isPaused = false;
  let isMuted = false;
  let effectiveMaxSecond = MAX_SECOND;
  let lastTargetSecond = null;
  let queuedStartSecond = null;
  let pendingSeekTarget = null;
  let pendingSeekTimestamp = 0;
  let didCorrectInitialSeek = false;
  let timeTickerId = null;
  let audioCtx = null;

  function setVisible(element, visible) {
    if (!element) return;
    if (visible) {
      element.removeAttribute('hidden');
    } else {
      element.setAttribute('hidden', '');
    }
  }

  // Fallback instantáneo si ./logo.png no está presente en la carpeta
  function activateLogoFallback() {
    setVisible(brandLogo, false);
    setVisible(logoFallback, true);
  }

  if (brandLogo) {
    brandLogo.addEventListener('error', activateLogoFallback);
    if (brandLogo.complete && brandLogo.naturalWidth === 0) {
      activateLogoFallback();
    }
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    return [hours, minutes, seconds]
      .map((unit) => String(unit).padStart(2, '0'))
      .join(':');
  }

  function pickRandomSecond(previousSecond, maxSecond) {
    const upper = Math.max(MIN_SECOND + 30, maxSecond);
    const span = upper - MIN_SECOND + 1;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = MIN_SECOND + Math.floor(Math.random() * span);
      if (previousSecond === null || Math.abs(candidate - previousSecond) >= MIN_JUMP_GAP) {
        return candidate;
      }
    }

    return MIN_SECOND + Math.floor(Math.random() * span);
  }

  function playDialStaticBurst() {
    if (isMuted) return;

    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;

      if (!audioCtx) {
        audioCtx = new AudioContextCtor();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const duration = 0.095;
      const sampleRate = audioCtx.sampleRate;
      const frameCount = Math.floor(sampleRate * duration);
      const buffer = audioCtx.createBuffer(1, frameCount, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < frameCount; i += 1) {
        const envelope = 1 - i / frameCount;
        data[i] = (Math.random() * 2 - 1) * envelope;
      }

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;

      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1450, audioCtx.currentTime);
      bandpass.Q.setValueAtTime(1.8, audioCtx.currentTime);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.065, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

      source.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(audioCtx.destination);
      source.start();
    } catch {
      // Silencioso si Web Audio está restringido
    }
  }

  function triggerHapticFeedback() {
    try {
      if (navigator && typeof navigator.vibrate === 'function') {
        navigator.vibrate(16);
      }
    } catch {
      // Ignorado si vibración no está disponible
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      if (typeof MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Reproductor Coco',
          artist: 'Cocoteo FM',
          album: 'Radio en vivo',
          artwork: [
            {
              src: new URL('./logo.png', window.location.href).href,
              sizes: '304x277',
              type: 'image/png',
            },
          ],
        });
      }
    } catch {
      // Ignorado si MediaMetadata falla
    }

    const handlers = {
      play: () => {
        if (!hasStarted) {
          tuneRandomMoment();
        } else if (isPaused) {
          togglePause();
        }
      },
      pause: () => {
        if (hasStarted && !isPaused) {
          togglePause();
        }
      },
      nexttrack: () => {
        tuneRandomMoment();
      },
    };

    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Acción no soportada por este navegador
      }
    });
  }

  function updateMediaSessionPlaybackState(playbackState) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playbackState;
    } catch {
      // Ignorado si no es soportado
    }
  }

  function triggerTuneMicrointeractions() {
    if (logoInner) {
      logoInner.classList.remove('is-tuning');
      void logoInner.offsetWidth;
      logoInner.classList.add('is-tuning');
    }

    if (!sparkleLayer) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    sparkleLayer.textContent = '';
    const count = 8;
    const classes = ['sparkle', 'sparkle sparkle--mint', 'sparkle sparkle--white'];

    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement('span');
      dot.className = classes[i % classes.length];

      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.35 - 0.17);
      const distance = 76 + Math.random() * 48;
      dot.style.setProperty('--tx', `${Math.round(Math.cos(angle) * distance)}px`);
      dot.style.setProperty('--ty', `${Math.round(Math.sin(angle) * distance)}px`);

      sparkleLayer.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove(), { once: true });
    }
  }

  function updatePauseButtonUI(paused) {
    isPaused = paused;
    setVisible(iconPause, !paused);
    setVisible(iconPlay, paused);
    pauseBtn.classList.toggle('is-active', paused);
    pauseBtn.setAttribute('aria-label', paused ? 'Reanudar audio' : 'Pausar audio');
    pauseBtn.setAttribute('aria-pressed', String(paused));
  }

  function updateMuteButtonUI(muted) {
    isMuted = muted;
    document.body.classList.toggle('is-muted', muted);
    setVisible(iconSound, !muted);
    setVisible(iconMuted, muted);
    muteBtn.classList.toggle('is-active', muted);
    muteBtn.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar audio');
    muteBtn.setAttribute('aria-pressed', String(muted));
  }

  function setVisualState(mode) {
    document.body.classList.toggle('is-playing', mode === 'playing');
    document.body.classList.toggle('is-buffering', mode === 'buffering');
    document.body.classList.toggle('is-paused', mode === 'paused');
  }

  function updateLiveTimestamp() {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    const current = player.getCurrentTime();
    if (!Number.isFinite(current)) return;

    const formatted = formatTime(current);
    if (isMuted) {
      statusText.textContent = `🔇 Silenciado · ${formatted}`;
    } else if (isPaused) {
      statusText.textContent = `⏸️ En pausa · ${formatted}`;
    } else {
      statusText.textContent = `📻 Sintonizando ${formatted}`;
    }
  }

  function startTimeTicker() {
    stopTimeTicker();
    updateLiveTimestamp();
    timeTickerId = window.setInterval(updateLiveTimestamp, 250);
  }

  function stopTimeTicker() {
    if (timeTickerId !== null) {
      window.clearInterval(timeTickerId);
      timeTickerId = null;
    }
  }

  function refreshEffectiveDuration() {
    if (!player || typeof player.getDuration !== 'function') return;
    const duration = player.getDuration();
    if (Number.isFinite(duration) && duration > 120) {
      effectiveMaxSecond = Math.min(MAX_SECOND, Math.floor(duration) - 30);
    }
  }

  function enableSecondaryControls() {
    if (!hasStarted) {
      hasStarted = true;
      document.body.classList.add('has-started');
      pauseBtn.disabled = false;
      muteBtn.disabled = false;
    }
  }

  function tuneRandomMoment() {
    const targetSec = pickRandomSecond(lastTargetSecond, effectiveMaxSecond);
    lastTargetSecond = targetSec;

    triggerHapticFeedback();
    playDialStaticBurst();
    triggerTuneMicrointeractions();
    enableSecondaryControls();
    updatePauseButtonUI(false);

    tuneBtnLabel.textContent = 'CAMBIAR MOMENTO';
    setVisualState('buffering');
    statusText.textContent = `📻 Sintonizando ${formatTime(targetSec)}...`;

    if (isPlayerReady && player) {
      if (isMuted && typeof player.unMute === 'function') {
        player.unMute();
        updateMuteButtonUI(false);
      }

      pendingSeekTarget = targetSec;
      pendingSeekTimestamp = Date.now();
      didCorrectInitialSeek = false;

      // Llamada síncrona dentro del clic del usuario para cumplir políticas de autoplay
      player.seekTo(targetSec, true);
      player.playVideo();
    } else {
      queuedStartSecond = targetSec;
      statusText.textContent = `📻 Conectando señal (${formatTime(targetSec)})...`;
    }
  }

  function handlePlayerReady() {
    isPlayerReady = true;
    refreshEffectiveDuration();

    if (typeof player.getIframe === 'function') {
      const iframe = player.getIframe();
      if (iframe) iframe.setAttribute('tabindex', '-1');
    }

    if (queuedStartSecond !== null) {
      const target = queuedStartSecond;
      queuedStartSecond = null;

      pendingSeekTarget = target;
      pendingSeekTimestamp = Date.now();
      didCorrectInitialSeek = false;

      player.seekTo(target, true);
      player.playVideo();

      window.setTimeout(() => {
        if (!player || typeof player.getPlayerState !== 'function') return;
        const state = player.getPlayerState();
        if (
          state !== YT.PlayerState.PLAYING &&
          state !== YT.PlayerState.BUFFERING &&
          !isPaused
        ) {
          stopTimeTicker();
          setVisualState('idle');
          statusText.textContent = '📻 Listo — toca de nuevo para escuchar';
        }
      }, 2500);
    }
  }

  function handlePlayerStateChange(event) {
    const state = event.data;

    if (state === YT.PlayerState.PLAYING) {
      if (
        pendingSeekTarget !== null &&
        !didCorrectInitialSeek &&
        Date.now() - pendingSeekTimestamp < SEEK_GUARD_WINDOW_MS
      ) {
        const current = player.getCurrentTime();
        if (Math.abs(current - pendingSeekTarget) > SEEK_DRIFT_TOLERANCE_SEC) {
          didCorrectInitialSeek = true;
          player.seekTo(pendingSeekTarget, true);
          return;
        }
      }

      pendingSeekTarget = null;
      refreshEffectiveDuration();
      updatePauseButtonUI(false);
      setVisualState('playing');
      updateMediaSessionPlaybackState('playing');
      tuneBtnLabel.textContent = 'CAMBIAR MOMENTO';
      startTimeTicker();
      return;
    }

    if (state === YT.PlayerState.BUFFERING) {
      stopTimeTicker();
      setVisualState('buffering');
      const refTime = pendingSeekTarget !== null
        ? pendingSeekTarget
        : (typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0);
      statusText.textContent = `📻 Sintonizando ${formatTime(refTime)}...`;
      return;
    }

    if (state === YT.PlayerState.PAUSED) {
      stopTimeTicker();
      updatePauseButtonUI(true);
      setVisualState('paused');
      updateMediaSessionPlaybackState('paused');
      const current = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      statusText.textContent = `⏸️ En pausa · ${formatTime(current)}`;
      return;
    }

    if (state === YT.PlayerState.ENDED) {
      stopTimeTicker();
      tuneRandomMoment();
    }
  }

  function handlePlayerError(event) {
    stopTimeTicker();
    setVisualState('idle');

    if (window.location.protocol === 'file:') {
      statusText.textContent = '⚠️ Abre con servidor local (ej. npx serve) para activar YouTube';
      return;
    }

    statusText.textContent = `⚠️ Error de YouTube (${event.data}) — toca para reintentar`;
  }

  function togglePause() {
    if (!hasStarted || !isPlayerReady || !player) return;

    if (isPaused) {
      updatePauseButtonUI(false);
      setVisualState('buffering');
      player.playVideo();
    } else {
      updatePauseButtonUI(true);
      setVisualState('paused');
      updateMediaSessionPlaybackState('paused');
      stopTimeTicker();
      player.pauseVideo();
      const current = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      statusText.textContent = `⏸️ En pausa · ${formatTime(current)}`;
    }
  }

  function toggleMute() {
    if (!hasStarted || !isPlayerReady || !player) return;

    if (isMuted) {
      player.unMute();
      updateMuteButtonUI(false);
    } else {
      player.mute();
      updateMuteButtonUI(true);
    }

    updateLiveTimestamp();
  }

  // Eventos de UI
  tuneBtn.addEventListener('click', tuneRandomMoment);

  tuneBtn.addEventListener('pointerdown', () => tuneBtn.classList.add('is-pressed'));
  const releasePress = () => tuneBtn.classList.remove('is-pressed');
  tuneBtn.addEventListener('pointerup', releasePress);
  tuneBtn.addEventListener('pointercancel', releasePress);
  tuneBtn.addEventListener('pointerleave', releasePress);

  pauseBtn.addEventListener('click', togglePause);
  muteBtn.addEventListener('click', toggleMute);

  document.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (event.key === 'p' || event.key === 'P') {
      togglePause();
    } else if (event.key === 'm' || event.key === 'M') {
      toggleMute();
    }
  });

  // Inicialización de YouTube IFrame Player API
  window.onYouTubeIframeAPIReady = () => {
    const isHttpOrigin = /^https?:$/.test(window.location.protocol);
    const playerVars = {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      enablejsapi: 1,
    };

    if (isHttpOrigin) {
      playerVars.origin = window.location.origin;
    }

    player = new YT.Player('yt-player', {
      videoId: VIDEO_ID,
      width: '200',
      height: '112',
      playerVars,
      events: {
        onReady: handlePlayerReady,
        onStateChange: handlePlayerStateChange,
        onError: handlePlayerError,
      },
    });
  };

  setupMediaSession();

  const apiScript = document.createElement('script');
  apiScript.src = 'https://www.youtube.com/iframe_api';
  apiScript.async = true;
  apiScript.onerror = () => {
    statusText.textContent = '⚠️ No se pudo cargar la API de YouTube';
  };
  document.head.appendChild(apiScript);
})();
