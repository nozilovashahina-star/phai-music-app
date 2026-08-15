/**
 * PHAI MUSIC — js/player.js
 * ============================================================
 * Audio engine: HTML5 <audio>, queue management, shuffle,
 * repeat, volume, MediaSession API (lock-screen controls).
 *
 * Exposes a single global object: Player
 * ============================================================
 */

const Player = (() => {

  // ── Core audio element ────────────────────────────────────
  const audio = document.getElementById('audio-player');

  // ── Internal state ─────────────────────────────────────────
  let _queue    = [];    // Song[] — current playback order
  let _origQ    = [];    // Song[] — pre-shuffle order (restored on unshuffle)
  let _idx      = 0;     // index into _queue for current song
  let _playing  = false;
  let _shuffled = false;
  let _repeat   = false; // repeat single song
  let _volume   = 0.8;   // 0–1

  // ── Event callbacks (wired up by app.js) ──────────────────
  let _onSongChange    = null;   // (song) => void
  let _onPlayChange    = null;   // (isPlaying) => void
  let _onProgress      = null;   // (currentTime, duration) => void

  // ══ INIT ═══════════════════════════════════════════════════
  /**
   * Call once at startup with event handler callbacks.
   *
   * @param {{ onSongChange, onPlayChange, onProgress }} cb
   */
  function init(cb = {}) {
    _onSongChange = cb.onSongChange || null;
    _onPlayChange = cb.onPlayChange || null;
    _onProgress   = cb.onProgress   || null;

    audio.volume = _volume;

    // --- Audio events ---

    audio.addEventListener('timeupdate', () => {
      if (_onProgress) _onProgress(audio.currentTime, audio.duration || 0);
    });

    audio.addEventListener('loadedmetadata', () => {
      // Back-fill duration on the song object
      const s = currentSong();
      if (s) s.duration = audio.duration;
      // Push the current duration immediately into the progress bar
      if (_onProgress) _onProgress(audio.currentTime, audio.duration || 0);
    });

    audio.addEventListener('playing', () => {
      _playing = true;
      if (_onPlayChange) _onPlayChange(true);
    });

    audio.addEventListener('pause', () => {
      _playing = false;
      if (_onPlayChange) _onPlayChange(false);
    });

    audio.addEventListener('ended', _onEnded);

    audio.addEventListener('error', e => {
      console.error('[Player] Audio error:', e.target.error?.message || e);
    });

    // --- MediaSession API (Android lock screen / notification) ---
    _setupMediaSession();
  }

  // ══ QUEUE ══════════════════════════════════════════════════
  /**
   * Replace the entire playback queue.
   * @param {Song[]}  songs       - full list of songs
   * @param {number}  startIndex  - which song to mark as "current"
   */
  function setQueue(songs, startIndex = 0) {
    if (!songs || songs.length === 0) {
      _origQ = [];
      _queue = [];
      _idx   = 0;
      return;
    }

    _origQ = [...songs];
    const validIdx = Math.max(0, Math.min(startIndex, songs.length - 1));
    const selected = songs[validIdx];

    if (_shuffled) {
      const others = songs.filter((_, i) => i !== validIdx);
      _queue = selected ? [selected, ..._shuffle([...others])] : _shuffle([...songs]);
      _idx   = 0;
    } else {
      _queue = [...songs];
      _idx   = validIdx;
    }
  }

  // ══ PLAY A SONG ════════════════════════════════════════════
  /**
   * Load and play a specific Song object.
   * Fires _onSongChange so the app can update the UI.
   */
  function _loadAndPlay(song) {
    if (!song || !song.url) {
      console.warn('[Player] No song URL to play');
      return;
    }

    audio.src    = song.url;
    audio.volume = _volume;

    const p = audio.play();
    if (p) p.catch(err => console.warn('[Player] play() blocked:', err));

    if (_onSongChange) _onSongChange(song);
    _updateMediaSession(song);
  }

  /** Play the song at a given queue index. */
  function _playIdx(idx) {
    if (_queue.length === 0) return;
    _idx = ((idx % _queue.length) + _queue.length) % _queue.length;  // wrap
    _loadAndPlay(_queue[_idx]);
  }

  // ══ PUBLIC CONTROLS ════════════════════════════════════════

  /** Toggle play / pause. */
  function togglePlay() {
    if (!audio.src) return;
    if (audio.paused) {
      audio.play().catch(e => console.warn('[Player] play() blocked:', e));
    } else {
      audio.pause();
    }
  }

  /** Skip to next track. */
  function next() {
    if (_queue.length === 0) return;
    // When shuffle is on and reached the end of queue, create fresh random order
    if (_shuffled && _queue.length > 1 && _idx >= _queue.length - 1) {
      const cur = currentSong();
      const all = _origQ.length > 0 ? _origQ : (typeof Library !== 'undefined' ? Library.getSongs() : []);
      const others = all.filter(s => !cur || s.id !== cur.id);
      _queue = cur ? [cur, ..._shuffle([...others])] : _shuffle([...all]);
      _idx = 0;
    }
    _playIdx(_idx + 1);
  }

  /** Go to previous track (or restart if >3 s in). */
  function prev() {
    if (_queue.length === 0) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;  // restart current song
    } else {
      _playIdx(_idx - 1);
    }
  }

  /**
   * Jump to a specific song already in the queue by its id.
   * If the song is not in the queue, rebuild the queue from all
   * library songs and start from there.
   */
  function playById(songId) {
    const qIdx = _queue.findIndex(s => s.id === songId);
    if (qIdx !== -1) {
      _playIdx(qIdx);
    } else {
      // Song not in queue (e.g. played from Favorites view)
      const all = typeof Library !== 'undefined' ? Library.getSongs() : [];
      const libIdx = all.findIndex(s => s.id === songId);
      setQueue(all, Math.max(0, libIdx));
      _playIdx(_idx);
    }
  }

  // ══ SEEK ═══════════════════════════════════════════════════

  /**
   * Seek to a percentage of the total duration (0–100).
   * Called by the progress bar click/drag handler.
   */
  function seekPct(pct) {
    if (!isFinite(audio.duration) || audio.duration === 0) return;
    audio.currentTime = (pct / 100) * audio.duration;
  }

  /** Seek to an absolute second value. */
  function seekTo(secs) {
    if (isFinite(secs)) audio.currentTime = secs;
  }

  // ══ VOLUME ═════════════════════════════════════════════════

  /** @param {number} val  0–100 */
  function setVolume(val) {
    _volume = Math.max(0, Math.min(1, val / 100));
    audio.volume = _volume;
  }

  // ══ SHUFFLE ════════════════════════════════════════════════

  /**
   * Toggle shuffle mode.
   * When enabling: keep current song at the front of a shuffled queue.
   * When disabling: restore original order, keep current song position.
   * @returns {boolean} new shuffle state
   */
  function toggleShuffle() {
    _shuffled = !_shuffled;

    const cur = currentSong();
    const all = _origQ.length > 0 ? _origQ : (typeof Library !== 'undefined' ? Library.getSongs() : []);

    if (_shuffled) {
      const others   = all.filter(s => !cur || s.id !== cur.id);
      const shuffled = _shuffle([...others]);
      _queue = cur ? [cur, ...shuffled] : shuffled;
      _idx   = 0;
    } else {
      _queue = all.length > 0 ? [...all] : [..._origQ];
      _idx   = cur ? Math.max(0, _queue.findIndex(s => s.id === cur.id)) : 0;
    }

    return _shuffled;
  }

  /**
   * Fisher-Yates in-place shuffle.
   * @param {any[]} arr
   * @returns {any[]}
   */
  function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ══ REPEAT ═════════════════════════════════════════════════

  /** Toggle single-song repeat.  Returns new repeat state. */
  function toggleRepeat() {
    _repeat = !_repeat;
    return _repeat;
  }

  // ══ SONG END ═══════════════════════════════════════════════

  function _onEnded() {
    if (_repeat) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      next();
    }
  }

  // ══ GETTERS ════════════════════════════════════════════════

  function currentSong() { return _queue[_idx] || null; }

  function nextSong() {
    if (_queue.length <= 1) return null;
    const nextIdx = (_idx + 1) % _queue.length;
    return _queue[nextIdx] || null;
  }

  // ══ MEDIA SESSION API ══════════════════════════════════════
  // Lets the Android system show track info + controls on the
  // lock screen / notification shade.

  function _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play',          () => audio.play());
    navigator.mediaSession.setActionHandler('pause',         () => audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack',     () => next());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('seekto', evt => {
      if (evt.seekTime != null) seekTo(evt.seekTime);
    });
  }

  function _updateMediaSession(song) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title:  song.title,
      artist: song.artist,
      album:  '',
      artwork: song.cover
        ? [{ src: song.cover, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });

    navigator.mediaSession.playbackState = 'playing';
  }

  // ══ PUBLIC API ═════════════════════════════════════════════
  return {
    init,
    setQueue,
    playById,
    togglePlay,
    next,
    prev,
    seekPct,
    seekTo,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    currentSong,
    nextSong,
    // Read-only state getters
    get isPlaying()  { return _playing;  },
    get isShuffled() { return _shuffled; },
    get isRepeat()   { return _repeat;   },
  };

})();
