(() => {
  'use strict';

  /**
   * URL directa permanente opcional (p. ej. 'https://tu-servidor.com/cocoteo.mp3' o stream Icecast).
   * Déjala vacía ('') para configurarla desde el botón de enlace en la app o usar assets/audio/.
   */
  const DEFAULT_AUDIO_URL = '';

  /**
   * Lista de archivos locales de respaldo dentro de assets/audio/.
   */
  const AUDIO_TRACKS = ['./assets/audio/cocoteo.mp3'];
  const DEFAULT_FORMAT_FALLBACKS = [
    './assets/audio/cocoteo.mp3',
    './assets/audio/cocoteo.m4a',
    './assets/audio/cocoteo.ogg',
  ];

  const STORAGE_KEY_URL = 'reproductor_coco_audio_url';
  const MAX_HISTORY = 20;
  const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtu\.be)$/i;

  const brandLogo = document.getElementById('brand-logo');
  const logoFallback = document.getElementById('logo-fallback');
  const logoInner = document.getElementById('logo-inner');
  const tuneBtn = document.getElementById('tune-btn');
  const tuneBtnLabel = document.getElementById('tune-btn-label');
  const sparkleLayer = document.getElementById('sparkle-layer');
  const statusText = document.getElementById('status-text');
  const pauseBtn = document.getElementById('pause-btn');
  const muteBtn = document.getElementById('mute-btn');
  const sourceBtn = document.getElementById('source-btn');
  const sourceModal = document.getElementById('source-modal');
  const sourceCloseBtn = document.getElementById('source-close-btn');
  const sourceForm = document.getElementById('source-form');
  const sourceUrlInput = document.getElementById('source-url-input');
  const sourceModalError = document.getElementById('source-modal-error');
  const sourceResetBtn = document.getElementById('source-reset-btn');
  const sourceModalBackdrop = sourceModal
    ? sourceModal.querySelector('[data-close-modal]')
    : null;
  const radioAudio = document.getElementById('radio-audio');

  const iconPause = pauseBtn.querySelector('.icon-pause');
  const iconPlay = pauseBtn.querySelector('.icon-play');
  const iconSound = muteBtn.querySelector('.icon-sound');
  const iconMuted = muteBtn.querySelector('.icon-muted');

  const isDefaultSingleTrack =
    AUDIO_TRACKS.length === 1 && AUDIO_TRACKS[0] === './assets/audio/cocoteo.mp3';

  let configuredUrl = '';
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

  function validateAudioUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return { valid: false, error: 'Ingresa una URL de audio.' };
    }
    if (/\s/.test(trimmed) || trimmed.startsWith('//')) {
      return {
        valid: false,
        error: 'Usa una URL válida que empiece con https://, http:// o una ruta local.',
      };
    }

    if (trimmed.startsWith('./') || trimmed.startsWith('/')) {
      return { valid: true, url: trimmed };
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return {
        valid: false,
        error: 'Usa una URL válida que empiece con https://, http:// o una ruta local.',
      };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        error: 'Usa una URL válida que empiece con https://, http:// o una ruta local.',
      };
    }

    if (YOUTUBE_HOST_RE.test(parsed.hostname)) {
      return {
        valid: false,
        error:
          'Los enlaces de YouTube bloquean el segundo plano en móvil y muestran su propia portada. Pega una URL directa de .mp3, .m4a, .ogg o stream de radio.',
      };
    }

    return { valid: true, url: parsed.href };
  }

  function readSavedAudioUrl() {
    try {
      return window.localStorage.getItem(STORAGE_KEY_URL) || '';
    } catch {
      return '';
    }
  }

  function writeSavedAudioUrl(url) {
    try {
      if (url) {
        window.localStorage.setItem(STORAGE_KEY_URL, url);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_URL);
      }
    } catch {
      // Ignorado si localStorage no está disponible
    }
  }

  function isCustomUrlActive() {
    return Boolean(configuredUrl);
  }

  function updateSourceButtonUI() {
    if (!sourceBtn) return;
    const active = isCustomUrlActive();
    sourceBtn.classList.toggle('is-active', active);
    sourceBtn.setAttribute('aria-pressed', String(active));
  }

  function resolveInitialAudioConfig() {
    let queryUrl = '';
    try {
      queryUrl = new URLSearchParams(window.location.search).get('url') || '';
    } catch {
      queryUrl = '';
    }

    if (queryUrl) {
      const checkedQuery = validateAudioUrl(queryUrl);
      if (checkedQuery.valid) {
        configuredUrl = checkedQuery.url;
        activeTracks = [checkedQuery.url];
        writeSavedAudioUrl(checkedQuery.url);
        updateSourceButtonUI();
        return;
      }
    }

    const saved = readSavedAudioUrl();
    if (saved) {
      const checkedSaved = validateAudioUrl(saved);
      if (checkedSaved.valid) {
        configuredUrl = checkedSaved.url;
        activeTracks = [checkedSaved.url];
        updateSourceButtonUI();
        return;
      }
    }

    if (DEFAULT_AUDIO_URL.trim()) {
      const checkedDefault = validateAudioUrl(DEFAULT_AUDIO_URL);
      if (checkedDefault.valid) {
        configuredUrl = checkedDefault.url;
        activeTracks = [checkedDefault.url];
        updateSourceButtonUI();
        return;
      }
    }

    configuredUrl = '';
    activeTracks = AUDIO_TRACKS.slice();
    updateSourceButtonUI();
  }

  function isLiveStreamDuration(duration) {
    return duration === Infinity;
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

    if (isLiveStreamDuration(radioAudio.duration)) {
      if (isMuted) {
        statusText.textContent = '🔇 Silenciado · En vivo';
      } else if (isPaused || radioAudio.paused) {
        statusText.textContent = '⏸️ En pausa · En vivo';
      } else if (current >= 1) {
        statusText.textContent = `📻 En vivo · ${formatted}`;
      } else {
        statusText.textContent = '📻 En vivo · Cocoteo FM';
      }
      return;
    }

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

  function applyMediaSessionMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata !== 'function') return;

    try {
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
        ],
      });
    } catch {
      // Ignorado si MediaMetadata falla
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

    applyMediaSessionMetadata();

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
    if (isLiveStreamDuration(radioAudio.duration)) return;
    const current = Number.isFinite(radioAudio.currentTime) ? Math.floor(radioAudio.currentTime) : 0;
    tuneHistory.push({ trackIndex: currentTrackIndex, time: current });
    if (tuneHistory.length > MAX_HISTORY) {
      tuneHistory.shift();
    }
  }

  function prepareFallbackQueue(initialUrl) {
    if (isCustomUrlActive() || !isDefaultSingleTrack) {
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

  function showSourceModalError(message) {
    if (!sourceModalError) return;
    if (message) {
      sourceModalError.textContent = message;
      setVisible(sourceModalError, true);
    } else {
      sourceModalError.textContent = '';
      setVisible(sourceModalError, false);
    }
  }

  function isSourceModalOpen() {
    return Boolean(sourceModal && !sourceModal.hasAttribute('hidden'));
  }

  function openSourceModal() {
    if (!sourceModal) return;
    if (sourceUrlInput) {
      sourceUrlInput.value = configuredUrl || '';
    }
    showSourceModalError('');
    setVisible(sourceModal, true);
    if (sourceUrlInput) {
      window.setTimeout(() => sourceUrlInput.focus(), 20);
    }
  }

  function closeSourceModal() {
    if (!sourceModal) return;
    setVisible(sourceModal, false);
    showSourceModalError('');
    if (sourceBtn) {
      sourceBtn.focus();
    }
  }

  function handleSourceFormSubmit(event) {
    event.preventDefault();
    if (!sourceUrlInput) return;

    const result = validateAudioUrl(sourceUrlInput.value);
    if (!result.valid) {
      showSourceModalError(result.error);
      sourceUrlInput.focus();
      return;
    }

    configuredUrl = result.url;
    activeTracks = [result.url];
    currentTrackIndex = 0;
    lastTargetTime = null;
    tuneHistory.length = 0;
    writeSavedAudioUrl(result.url);
    updateSourceButtonUI();

    if (radioAudio) {
      radioAudio.pause();
      radioAudio.removeAttribute('src');
    }

    closeSourceModal();
    tuneRandomMoment();
  }

  function handleSourceReset() {
    writeSavedAudioUrl('');
    tuneHistory.length = 0;
    lastTargetTime = null;
    currentTrackIndex = 0;

    if (DEFAULT_AUDIO_URL.trim()) {
      const checkedDefault = validateAudioUrl(DEFAULT_AUDIO_URL);
      configuredUrl = checkedDefault.valid ? checkedDefault.url : '';
      activeTracks = configuredUrl ? [configuredUrl] : AUDIO_TRACKS.slice();
    } else {
      configuredUrl = '';
      activeTracks = AUDIO_TRACKS.slice();
    }

    updateSourceButtonUI();

    if (radioAudio) {
      radioAudio.pause();
      radioAudio.removeAttribute('src');
      radioAudio.load();
    }

    resetToIdleUnavailable('📻 Presiona para sintonizar');
    closeSourceModal();
  }

  function applyPendingSeek() {
    if (!radioAudio || pendingSeekMode === null) return;

    const duration = radioAudio.duration;
    if (isLiveStreamDuration(duration)) {
      pendingSeekMode = null;
      lastTargetTime = null;
      clearTemporarySeekMute();
      applyMediaSessionMetadata();
      updateLiveTimestamp();
      return;
    }

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
    applyMediaSessionMetadata();
    updateMediaSessionPositionState(true);
  }

  // Eventos nativos del reproductor HTML5 <audio>
  if (radioAudio) {
    radioAudio.addEventListener('loadedmetadata', () => {
      applyMediaSessionMetadata();
      applyPendingSeek();
    });
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
      applyMediaSessionMetadata();
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

      if (isCustomUrlActive()) {
        resetToIdleUnavailable('⚠️ No se pudo reproducir esa URL de audio');
      } else if (isDefaultSingleTrack) {
        resetToIdleUnavailable('🔗 Configura una URL de audio (botón de enlace)');
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
      applyMediaSessionMetadata();
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

  if (sourceBtn) {
    sourceBtn.addEventListener('click', openSourceModal);
  }
  if (sourceCloseBtn) {
    sourceCloseBtn.addEventListener('click', closeSourceModal);
  }
  if (sourceModalBackdrop) {
    sourceModalBackdrop.addEventListener('click', closeSourceModal);
  }
  if (sourceForm) {
    sourceForm.addEventListener('submit', handleSourceFormSubmit);
  }
  if (sourceResetBtn) {
    sourceResetBtn.addEventListener('click', handleSourceReset);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isSourceModalOpen()) {
      closeSourceModal();
      return;
    }

    if (isSourceModalOpen()) return;

    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (event.key === 'p' || event.key === 'P') {
      togglePause();
    } else if (event.key === 'm' || event.key === 'M') {
      toggleMute();
    }
  });

  resolveInitialAudioConfig();
  setupMediaSession();

  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Ignorado si Service Worker no está disponible
      });
    });
  }
})();
