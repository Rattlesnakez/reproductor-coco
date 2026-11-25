(() => {
  'use strict';

  /**
   * Lista de archivos de audio locales dentro de assets/audio/.
   * - Archivo único largo: deja ['./assets/audio/cocoteo.mp3']
   * - Múltiples clips: agrega varias rutas, por ejemplo:
   *   ['./assets/audio/clip-1.mp3', './assets/audio/clip-2.mp3']
   */
  const AUDIO_TRACKS = ['./assets/audio/cocoteo.mp3'];
  const DEFAULT_FORMAT_FALLBACKS = [
    './assets/audio/cocoteo.mp3',
    './assets/audio/cocoteo.m4a',
    './assets/audio/cocoteo.ogg',
  ];

  const MAX_HISTORY = 20;

  const brandLogo = document.getElementById('brand-logo');
  const logoFallback = document.getElementById('logo-fallback');
  const logoInner = document.getElementById('logo-inner');
  const tuneBtn = document.getElementById('tune-btn');
  const tuneBtnLabel = document.getElementById('tune-btn-label');
  const sparkleLayer = document.getElementById('sparkle-layer');
  const statusText = document.getElementById('status-text');
  const pauseBtn = document.getElementById('pause-btn');
  const muteBtn = document.getElementById('mute-btn');
  const radioAudio = document.getElementById('radio-audio');

  const iconPause = pauseBtn.querySelector('.icon-pause');
  const iconPlay = pauseBtn.querySelector('.icon-play');
  const iconSound = muteBtn.querySelector('.icon-sound');
  const iconMuted = muteBtn.querySelector('.icon-muted');

  const isDefaultSingleTrack =
    AUDIO_TRACKS.length === 1 && AUDIO_TRACKS[0] === './assets/audio/cocoteo.mp3';

  let activeTracks = AUDIO_TRACKS.slice();
  let currentTrackIndex = 0;
  let fallbackQueue = [];
  let hasStarted = false;
  let isPaused = false;
  let isMuted = false;
  let lastTargetTime = null;
  let pendingSeekMode = null; // 'random' | 'exact' | null
  let pendingExactTime = 0;
  let temporarilyMutedForSeek = false;
  let tempMuteTimerId = null;
  let lastPositionUpdateAt = 0;
  let audioCtx = null;
  const tuneHistory = [];

  function setVisible(element, visible) {
    if (!element) return;
    if (visible) {
      element.removeAttribute('hidden');
    } else {
      element.setAttribute('hidden', '');
    }
  }

  // Fallback instantáneo si ./logo.png no está presente
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

  function canPlayUrl(url) {
    if (!radioAudio || typeof radioAudio.canPlayType !== 'function') return true;
    const clean = url.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp3')) return Boolean(radioAudio.canPlayType('audio/mpeg'));
    if (clean.endsWith('.m4a') || clean.endsWith('.mp4')) {
      return Boolean(radioAudio.canPlayType('audio/mp4') || radioAudio.canPlayType('audio/aac'));
    }
    if (clean.endsWith('.ogg') || clean.endsWith('.oga')) {
      return Boolean(radioAudio.canPlayType('audio/ogg'));
    }
    if (clean.endsWith('.wav')) return Boolean(radioAudio.canPlayType('audio/wav'));
    if (clean.endsWith('.aac')) return Boolean(radioAudio.canPlayType('audio/aac'));
    return true;
  }

  function pickRandomTrackIndex() {
    if (activeTracks.length <= 1) return 0;
    const candidates = [];
    for (let i = 0; i < activeTracks.length; i += 1) {
      if (i !== currentTrackIndex) candidates.push(i);
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function pickRandomTimeForDuration(duration, previousTime, isSameTrack) {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    if (activeTracks.length > 1 && duration < 60) {
      return 0;
    }

    const minStart = duration > 20 ? 5 : 0;
    const maxEnd = duration > 45 ? duration - 30 : Math.max(minStart + 1, duration - 2);
    if (maxEnd <= minStart) return minStart;

    const span = maxEnd - minStart;
    const minGap = Math.min(90, span * 0.25);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = Math.floor(minStart + Math.random() * span);
      if (!isSameTrack || previousTime === null || Math.abs(candidate - previousTime) >= minGap) {
        return candidate;
      }
    }

    return Math.floor(minStart + Math.random() * span);
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

  function enableSecondaryControls() {
    if (!hasStarted) {
      hasStarted = true;
      document.body.classList.add('has-started');
      pauseBtn.disabled = false;
      muteBtn.disabled = false;
    }
  }

  function resetToIdleUnavailable(message) {
    hasStarted = false;
    pendingSeekMode = null;
    clearTemporarySeekMute();
    document.body.classList.remove('has-started');
    setVisualState('idle');
    updatePauseButtonUI(false);
    updateMediaSessionPlaybackState('none');
    pauseBtn.disabled = true;
    muteBtn.disabled = true;
    tuneBtnLabel.textContent = 'SINTONIZAR RADIO';
    statusText.textContent = message;
  }

  function updateLiveTimestamp() {
    if (!radioAudio) return;
    const current = Number.isFinite(radioAudio.currentTime) ? radioAudio.currentTime : 0;
    const formatted = formatTime(current);

    if (isMuted) {
      statusText.textContent = `🔇 Silenciado · ${formatted}`;
    } else if (isPaused || radioAudio.paused) {
      statusText.textContent = `⏸️ En pausa · ${formatted}`;
    } else {
      statusText.textContent = `📻 Sintonizando ${formatted}`;
    }
  }

  function beginTemporarySeekMute() {
    if (!radioAudio) return;
    if (tempMuteTimerId !== null) {
      window.clearTimeout(tempMuteTimerId);
    }
    temporarilyMutedForSeek = true;
    radioAudio.muted = true;
    tempMuteTimerId = window.setTimeout(() => {
      clearTemporarySeekMute();
    }, 1500);
  }

  function clearTemporarySeekMute() {
    if (tempMuteTimerId !== null) {
      window.clearTimeout(tempMuteTimerId);
      tempMuteTimerId = null;
    }
    if (temporarilyMutedForSeek && radioAudio) {
      temporarilyMutedForSeek = false;
      radioAudio.muted = isMuted;
    }
  }

  function updateMediaSessionPlaybackState(playbackState) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playbackState;
    } catch {
      // Ignorado si no es soportado
    }
  }

  function updateMediaSessionPositionState(force = false) {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') {
      return;
    }
    if (!radioAudio) return;

    const now = Date.now();
    if (!force && now - lastPositionUpdateAt < 900) return;
    lastPositionUpdateAt = now;

    const duration = radioAudio.duration;
    const position = radioAudio.currentTime;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: radioAudio.playbackRate || 1,
        position: Math.min(Math.max(0, position), duration),
      });
    } catch {
      // Ignorado si setPositionState falla
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      if (typeof MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Cocoteo FM',
          artist: 'Radio en vivo',
          album: 'Reproductor Coco',
          artwork: [
            {
              src: new URL('./icon-192.png', window.location.href).href,
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: new URL('./icon-512.png', window.location.href).href,
              sizes: '512x512',
              type: 'image/png',
            },
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
        if (!hasStarted || !radioAudio.getAttribute('src')) {
          tuneRandomMoment({ fromMediaSession: true });
        } else {
          updatePauseButtonUI(false);
          setVisualState('buffering');
          safePlayAudio();
        }
      },
      pause: () => {
        if (hasStarted && !radioAudio.paused) {
          radioAudio.pause();
        }
      },
      stop: () => {
        if (hasStarted) {
          radioAudio.pause();
        }
      },
      nexttrack: () => {
        tuneRandomMoment({ fromMediaSession: true });
      },
      previoustrack: () => {
        if (tuneHistory.length > 0) {
          const prev = tuneHistory.pop();
          tuneRandomMoment({
            fromMediaSession: true,
            restorePoint: prev,
            skipHistory: true,
          });
        } else {
          tuneRandomMoment({ fromMediaSession: true });
        }
      },
      seekto: (details) => {
        if (!radioAudio || !details || !Number.isFinite(details.seekTime)) return;
        const duration = radioAudio.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        radioAudio.currentTime = Math.min(Math.max(0, details.seekTime), duration);
        updateLiveTimestamp();
        updateMediaSessionPositionState(true);
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

  function safePlayAudio() {
    if (!radioAudio) return;

    const playPromise = radioAudio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        if (radioAudio.error || fallbackQueue.length > 0) return;

        clearTemporarySeekMute();
        if (err && err.name === 'NotAllowedError') {
          setVisualState('paused');
          updatePauseButtonUI(true);
          updateMediaSessionPlaybackState('paused');
          statusText.textContent = '📻 Toca de nuevo para reproducir';
        }
      });
    }
  }

  function pushTuneHistory() {
    if (!hasStarted || !radioAudio || !radioAudio.getAttribute('src')) return;
    const current = Number.isFinite(radioAudio.currentTime) ? Math.floor(radioAudio.currentTime) : 0;
    tuneHistory.push({ trackIndex: currentTrackIndex, time: current });
    if (tuneHistory.length > MAX_HISTORY) {
      tuneHistory.shift();
    }
  }

  function prepareFallbackQueue(initialUrl) {
    if (!isDefaultSingleTrack) {
      fallbackQueue = [];
      return;
    }
    fallbackQueue = DEFAULT_FORMAT_FALLBACKS.filter(
      (url) => url !== initialUrl && canPlayUrl(url)
    );
  }

  function tuneRandomMoment(options = {}) {
    if (!radioAudio) return;

    const isBackgroundTrigger = Boolean(
      options.fromBackground || options.fromAutoAdvance || options.fromMediaSession
    );

    if (!isBackgroundTrigger) {
      triggerHapticFeedback();
      playDialStaticBurst();
    }

    triggerTuneMicrointeractions();
    enableSecondaryControls();
    updatePauseButtonUI(false);
    tuneBtnLabel.textContent = 'CAMBIAR MOMENTO';

    if (isMuted && !isBackgroundTrigger) {
      updateMuteButtonUI(false);
      radioAudio.muted = false;
    }

    const restore = options.restorePoint || null;
    const targetTrackIndex = restore ? restore.trackIndex : pickRandomTrackIndex();
    const targetUrl = activeTracks[targetTrackIndex] || activeTracks[0];
    const hasExistingSrc = Boolean(radioAudio.getAttribute('src'));
    const sameTrackReady =
      hasExistingSrc &&
      currentTrackIndex === targetTrackIndex &&
      radioAudio.readyState >= 1 &&
      Number.isFinite(radioAudio.duration) &&
      radioAudio.duration > 0;

    if (!options.skipHistory) {
      pushTuneHistory();
    }

    setVisualState('buffering');

    if (sameTrackReady) {
      clearTemporarySeekMute();
      const targetTime = restore
        ? Math.min(Math.max(0, restore.time), Math.max(0, radioAudio.duration - 1))
        : pickRandomTimeForDuration(radioAudio.duration, lastTargetTime, true);

      lastTargetTime = targetTime;
      pendingSeekMode = null;
      statusText.textContent = `📻 Sintonizando ${formatTime(targetTime)}...`;

      radioAudio.currentTime = targetTime;
      radioAudio.muted = isMuted;
      safePlayAudio();
      return;
    }

    currentTrackIndex = targetTrackIndex;
    pendingSeekMode = restore ? 'exact' : 'random';
    pendingExactTime = restore ? restore.time : 0;
    prepareFallbackQueue(targetUrl);

    if (!hasExistingSrc || radioAudio.getAttribute('src') !== targetUrl) {
      radioAudio.src = targetUrl;
    } else {
      radioAudio.load();
    }

    beginTemporarySeekMute();
    statusText.textContent = restore
      ? `📻 Sintonizando ${formatTime(restore.time)}...`
      : '📻 Sintonizando señal...';

    // Llamada síncrona dentro del evento del usuario para mantener audio desbloqueado
    safePlayAudio();
  }

  function togglePause() {
    if (!hasStarted || !radioAudio || !radioAudio.getAttribute('src')) return;

    if (radioAudio.paused) {
      updatePauseButtonUI(false);
      setVisualState('buffering');
      safePlayAudio();
    } else {
      radioAudio.pause();
    }
  }

  function toggleMute() {
    if (!hasStarted || !radioAudio) return;

    const nextMuted = !isMuted;
    updateMuteButtonUI(nextMuted);
    if (!temporarilyMutedForSeek) {
      radioAudio.muted = nextMuted;
    }
    updateLiveTimestamp();
  }

  function applyPendingSeek() {
    if (!radioAudio || pendingSeekMode === null) return;

    const duration = radioAudio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const seekable = radioAudio.seekable;
    const seekableEnd = seekable && seekable.length > 0
      ? seekable.end(seekable.length - 1)
      : 0;

    if (seekableEnd <= 1 && radioAudio.readyState < 3) {
      return;
    }

    const targetTime =
      pendingSeekMode === 'exact'
        ? Math.min(Math.max(0, pendingExactTime), Math.max(0, duration - 1))
        : pickRandomTimeForDuration(duration, null, false);

    pendingSeekMode = null;
    lastTargetTime = targetTime;
    statusText.textContent = `📻 Sintonizando ${formatTime(targetTime)}...`;

    if (targetTime > 0 && seekableEnd > 1) {
      radioAudio.currentTime = Math.min(targetTime, Math.max(0, seekableEnd - 1));
    } else {
      clearTemporarySeekMute();
    }
    updateMediaSessionPositionState(true);
  }

  // Eventos nativos del reproductor HTML5 <audio>
  if (radioAudio) {
    radioAudio.addEventListener('loadedmetadata', applyPendingSeek);
    radioAudio.addEventListener('canplay', applyPendingSeek);

    radioAudio.addEventListener('seeked', () => {
      clearTemporarySeekMute();
      if (!radioAudio.paused) {
        setVisualState('playing');
        updateMediaSessionPlaybackState('playing');
      }
      updateLiveTimestamp();
      updateMediaSessionPositionState(true);
    });

    radioAudio.addEventListener('playing', () => {
      if (pendingSeekMode === null) {
        clearTemporarySeekMute();
      }
      updatePauseButtonUI(false);
      setVisualState('playing');
      updateMediaSessionPlaybackState('playing');
      tuneBtnLabel.textContent = 'CAMBIAR MOMENTO';
      updateLiveTimestamp();
      updateMediaSessionPositionState(true);
    });

    radioAudio.addEventListener('waiting', () => {
      if (!radioAudio.paused) {
        setVisualState('buffering');
      }
    });

    radioAudio.addEventListener('seeking', () => {
      if (!radioAudio.paused) {
        setVisualState('buffering');
      }
    });

    radioAudio.addEventListener('pause', () => {
      if (radioAudio.ended) return;
      clearTemporarySeekMute();
      if (!hasStarted) return;
      updatePauseButtonUI(true);
      setVisualState('paused');
      updateMediaSessionPlaybackState('paused');
      updateLiveTimestamp();
      updateMediaSessionPositionState(true);
    });

    radioAudio.addEventListener('ended', () => {
      tuneRandomMoment({ fromAutoAdvance: true, skipHistory: true });
    });

    radioAudio.addEventListener('timeupdate', () => {
      if (!hasStarted || radioAudio.paused) return;
      updateLiveTimestamp();
      updateMediaSessionPositionState(false);
    });

    radioAudio.addEventListener('durationchange', () => {
      updateMediaSessionPositionState(true);
    });

    radioAudio.addEventListener('error', () => {
      clearTemporarySeekMute();

      if (fallbackQueue.length > 0) {
        const nextUrl = fallbackQueue.shift();
        activeTracks = [nextUrl];
        currentTrackIndex = 0;
        pendingSeekMode = 'random';
        beginTemporarySeekMute();
        radioAudio.src = nextUrl;
        safePlayAudio();
        return;
      }

      radioAudio.removeAttribute('src');
      radioAudio.load();

      if (isDefaultSingleTrack) {
        resetToIdleUnavailable('📂 Coloca tu audio en assets/audio/cocoteo.mp3');
      } else {
        resetToIdleUnavailable('📂 No se encontró el archivo de audio en assets/audio/');
      }
    });
  }

  // Sincroniza UI al volver de segundo plano sin detener nunca el audio
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !hasStarted || !radioAudio || !radioAudio.getAttribute('src')) return;

    if (radioAudio.paused) {
      updatePauseButtonUI(true);
      setVisualState('paused');
      updateMediaSessionPlaybackState('paused');
    } else {
      updatePauseButtonUI(false);
      setVisualState('playing');
      updateMediaSessionPlaybackState('playing');
    }
    updateLiveTimestamp();
    updateMediaSessionPositionState(true);
  });

  // Eventos de UI
  tuneBtn.addEventListener('click', () => tuneRandomMoment());

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

  setupMediaSession();

  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Ignorado si Service Worker no está disponible
      });
    });
  }
})();
