/**
 * PHAI MUSIC — js/library.js
 * ============================================================
 * Manages the song library, custom metadata overrides,
 * favorites list, and recently-played history.
 *
 * All persistent data (metadata, favorites, history) lives in
 * localStorage so it survives page refreshes without modifying
 * the original audio files.
 *
 * Exposes a single global object: Library
 * ============================================================
 */

const Library = (() => {

  // ── localStorage keys ─────────────────────────────────────
  const KEY = {
    META:    'phai_metadata',   // { [songId]: { title, artist, cover } }
    FAV:     'phai_favorites',  // string[] — song IDs
    RECENT:  'phai_recent',     // string[] — song IDs (newest first, max 15)
    THEME:   'phai_theme',      // string — 'content' | 'dark' | 'blue' | 'peach' | 'green'
    ALBUMS:  'phai_albums',     // Album[] — { id, name, cover, songIds: string[], createdAt }
  };

  // ── In-memory store ────────────────────────────────────────
  let songs    = [];   // Song[]
  let meta     = {};   // { [id]: { title?, artist?, cover? } }
  let favs     = [];   // string[]
  let recent   = [];   // string[]
  let albums   = [];   // Album[]

  // ══ INDEXED DB (Permanent Offline Audio Storage) ───────────
  const DB_NAME = 'phai_music_db';
  const DB_VERSION = 1;
  const DB_STORE = 'audio_blobs';

  function _openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => {
        console.warn('[Library] IndexedDB open error:', e);
        resolve(null);
      };
    });
  }

  async function _saveBlobToDB(songItem) {
    try {
      const db = await _openDB();
      if (!db) return;
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.put({
        id: songItem.id,
        blob: songItem.file,
        filename: songItem.filename,
        title: songItem.title,
        artist: songItem.artist,
        cover: songItem.cover || '',
        createdAt: Date.now()
      });
    } catch (e) {
      console.warn('[Library] IndexedDB save error:', e);
    }
  }

  async function _removeBlobFromDB(id) {
    try {
      const db = await _openDB();
      if (!db) return;
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
    } catch (e) {
      console.warn('[Library] IndexedDB delete error:', e);
    }
  }

  async function loadPersistedSongs() {
    try {
      const db = await _openDB();
      if (!db) return [];
      return new Promise(resolve => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          const restored = [];
          items.forEach(item => {
            if (item.blob && !songs.some(s => s.id === item.id)) {
              const url = URL.createObjectURL(item.blob);
              const custom = meta[item.id] || {};
              const song = {
                id: item.id,
                file: item.blob,
                url,
                filename: item.filename,
                title: custom.title || item.title,
                artist: custom.artist || item.artist,
                cover: custom.cover || item.cover || null,
                duration: 0,
                addedAt: item.createdAt || Date.now(),
              };
              songs.push(song);
              restored.push(song);
            }
          });
          resolve(restored);
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      console.warn('[Library] IndexedDB load error:', e);
      return [];
    }
  }

  // ══ BOOT ══════════════════════════════════════════════════
  function _load() {
    try {
      meta   = JSON.parse(localStorage.getItem(KEY.META)   || '{}');
      favs   = JSON.parse(localStorage.getItem(KEY.FAV)    || '[]');
      recent = JSON.parse(localStorage.getItem(KEY.RECENT) || '[]');
      albums = JSON.parse(localStorage.getItem(KEY.ALBUMS) || '[]');
    } catch (e) {
      console.warn('[Library] localStorage parse error:', e);
      meta = {}; favs = []; recent = []; albums = [];
    }
  }

  function _save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('[Library] Could not persist to localStorage:', e); }
  }

  // ══ SONG ID ════════════════════════════════════════════════
  /**
   * Generate a stable ID from a File object.
   * We use the filename + file size, which is unique enough for
   * personal music collections.  (We avoid hashing for speed.)
   */
  function _makeId(file) {
    const raw = file.name + '_' + file.size;
    // Simple base64-like encoding, keep only alphanumerics
    return btoa(encodeURIComponent(raw))
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 20);
  }

  // ══ FILENAME PARSING ═══════════════════════════════════════
  /**
   * Try to extract a title and artist from the filename.
   * Supports two common patterns:
   *   "Artist - Title.mp3"
   *   "Title.mp3"
   */
  function _parse(filename) {
    // Remove file extension
    const base = filename.replace(/\.[^/.]+$/, '').trim();

    if (base.includes(' - ')) {
      const idx    = base.indexOf(' - ');
      const artist = base.substring(0, idx).trim();
      const title  = base.substring(idx + 3).trim();
      return { title: title || base, artist: artist || '<unknown>' };
    }

    return { title: base, artist: '<unknown>' };
  }

  // ══ ADD SONGS ══════════════════════════════════════════════
  /**
   * Import an array of File objects into the library.
   * Skips non-audio files and duplicates.
   * Returns the newly added Song objects.
   */
  function addSongs(files) {
    const AUDIO_EXTS = /\.(mp3|flac|wav|ogg|m4a|aac|opus|weba)$/i;
    const added = [];

    for (const file of files) {
      // Accept by MIME type OR extension
      const isAudio =
        (file.type && file.type.startsWith('audio/')) ||
        AUDIO_EXTS.test(file.name);

      if (!isAudio) continue;

      const id = _makeId(file);

      // Skip if already in library
      if (songs.find(s => s.id === id)) continue;

      const url            = URL.createObjectURL(file);
      const { title, artist } = _parse(file.name);
      const override       = meta[id] || {};

      const song = {
        id,
        file,
        url,
        filename: file.name,
        title:    override.title  || title,
        artist:   override.artist || artist,
        cover:    override.cover  || null,
        duration: 0,    // updated by Player on 'loadedmetadata'
        addedAt:  Date.now(),
      };

      songs.push(song);
      added.push(song);

      // Persist blob to IndexedDB
      _saveBlobToDB(song);
    }

    return added;
  }

  // ══ REMOVE SONGS ═══════════════════════════════════════════
  function removeSong(id) {
    const song = songs.find(s => s.id === id);
    if (song) URL.revokeObjectURL(song.url);   // free memory

    songs  = songs.filter(s => s.id !== id);
    favs   = favs.filter(fid => fid !== id);
    recent = recent.filter(rid => rid !== id);

    _save(KEY.FAV,    favs);
    _save(KEY.RECENT, recent);

    // Remove blob from IndexedDB
    _removeBlobFromDB(id);
  }

  // ══ GETTERS ════════════════════════════════════════════════
  const getSongs       = ()      => [...songs];
  const getSongById    = id      => songs.find(s => s.id === id) || null;
  const getSongIndex   = id      => songs.findIndex(s => s.id === id);
  const getSongByIndex = index   => songs[index] || null;

  // ══ METADATA (custom title / artist / cover) ══════════════
  /**
   * Override display metadata for a song.
   * updates = { title?, artist?, cover? }
   * The original file is never touched.
   */
  function updateMeta(id, updates) {
    meta[id] = { ...(meta[id] || {}), ...updates };
    _save(KEY.META, meta);

    // Apply to in-memory song object immediately
    const song = songs.find(s => s.id === id);
    if (song) {
      if (updates.title  !== undefined) song.title  = updates.title;
      if (updates.artist !== undefined) song.artist = updates.artist;
      if (updates.cover  !== undefined) song.cover  = updates.cover;
    }
  }

  const getMeta = id => meta[id] || {};

  // ══ FAVORITES ══════════════════════════════════════════════
  /** Toggle favorite.  Returns true if now favorited. */
  function toggleFav(id) {
    const idx = favs.indexOf(id);
    if (idx === -1) { favs.push(id); }
    else            { favs.splice(idx, 1); }
    _save(KEY.FAV, favs);
    return favs.includes(id);
  }

  const isFav    = id => favs.includes(id);
  const getFavs  = ()  => favs.map(id => songs.find(s => s.id === id)).filter(Boolean);

  // ══ RECENTLY PLAYED ════════════════════════════════════════
  function addRecent(id) {
    recent = recent.filter(rid => rid !== id);  // remove if exists
    recent.unshift(id);                          // add at front
    recent = recent.slice(0, 15);               // keep last 15
    _save(KEY.RECENT, recent);
  }

  const getRecent = () => recent.map(id => songs.find(s => s.id === id)).filter(Boolean);

  // ══ SEARCH ═════════════════════════════════════════════════
  function search(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return getSongs();
    return songs.filter(s =>
      s.title.toLowerCase().includes(q)   ||
      s.artist.toLowerCase().includes(q)  ||
      s.filename.toLowerCase().includes(q)
    );
  }

  // ══ ALBUMS ═════════════════════════════════════════════════
  function getAlbums() {
    return [...albums];
  }

  function getAlbumById(id) {
    return albums.find(a => a.id === id) || null;
  }

  function createAlbum(name, cover = '', songIds = []) {
    const validIds = songIds.slice(0, 50); // max 50 songs
    const newAlbum = {
      id: 'alb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: (name || '').trim() || 'New Album',
      cover: cover || '',
      songIds: validIds,
      createdAt: Date.now(),
    };
    albums.unshift(newAlbum);
    _save(KEY.ALBUMS, albums);
    return newAlbum;
  }

  function updateAlbum(id, updates = {}) {
    const idx = albums.findIndex(a => a.id === id);
    if (idx === -1) return null;
    if (updates.name !== undefined) albums[idx].name = updates.name.trim();
    if (updates.cover !== undefined) albums[idx].cover = updates.cover;
    if (updates.songIds !== undefined) albums[idx].songIds = updates.songIds.slice(0, 50);
    _save(KEY.ALBUMS, albums);
    return albums[idx];
  }

  function deleteAlbum(id) {
    albums = albums.filter(a => a.id !== id);
    _save(KEY.ALBUMS, albums);
  }

  function getAlbumSongs(albumId) {
    const album = getAlbumById(albumId);
    if (!album) return [];
    return album.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean);
  }

  // ── Init ──────────────────────────────────────────────────
  _load();

  // ══ PUBLIC API ═════════════════════════════════════════════
  return {
    // Songs
    addSongs,
    removeSong,
    getSongs,
    getSongById,
    getSongIndex,
    getSongByIndex,
    loadPersistedSongs,
    // Meta
    updateMeta,
    getMeta,
    // Favorites
    toggleFav,
    isFav,
    getFavs,
    // Recent
    addRecent,
    getRecent,
    // Albums
    getAlbums,
    getAlbumById,
    createAlbum,
    updateAlbum,
    deleteAlbum,
    getAlbumSongs,
    // Search
    search,
    // Theme
    getTheme: () => {
      try { return localStorage.getItem(KEY.THEME) || 'content'; }
      catch { return 'content'; }
    },
    setTheme: (t) => {
      try { localStorage.setItem(KEY.THEME, t); }
      catch (e) { console.warn(e); }
    },
    // Computed
    get count() { return songs.length; },
  };

})();
