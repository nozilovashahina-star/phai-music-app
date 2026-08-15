/**
 * PHAI MUSIC — js/app.js
 * ============================================================
 * Main application coordinator.
 * Wires Library ↔ Player ↔ UI together and handles all user
 * events (buttons, file picker, search, modals, swipe).
 *
 * This file runs last (after library.js, ui.js, player.js).
 * ============================================================
 */

// ── App-level state ──────────────────────────────────────────
const App = {
  currentView:       'home',      // 'home' | 'library' | 'albums' | 'favorites'
  currentSong:       null,        // Song object currently loaded
  editingSongId:     null,        // id of song being edited in modal
  pendingCover:      null,        // base64 dataURL of a new cover (not yet saved)
  selectedAlbumId:   null,
  editingAlbumId:    null,
  pendingAlbumCover: null,
};

/** Compresses and resizes an uploaded image to keep localStorage small and fast */
function _compressImage(file, maxSize = 380, quality = 0.82) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxSize) { h = Math.round((h * maxSize) / w); w = maxSize; }
        } else {
          if (h > maxSize) { w = Math.round((w * maxSize) / h); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch { resolve(e.target.result); }
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Wait for the splash animation to finish, then show the app
  setTimeout(_boot, 1950);
});

async function _boot() {
  // Hide splash, reveal app
  const splash = document.getElementById('splash-screen');
  const main   = document.getElementById('main-app');
  if (splash) { splash.style.display = 'none'; }
  if (main)   { main.classList.remove('hidden'); }

  // Set greeting in header
  const greet = document.getElementById('header-greeting');
  if (greet) greet.textContent = UI.greeting();

  // Init Player with our callback handlers
  Player.init({
    onSongChange:  _handleSongChange,
    onPlayChange:  _handlePlayChange,
    onProgress:    _handleProgress,
  });

  // Apply persisted user theme
  UI.applyUserTheme(Library.getTheme());

  // Load all permanently saved audio files from IndexedDB
  await Library.loadPersistedSongs();

  // Bind all button / input events
  _bindEvents();

  // Initial render of all views
  renderHome();
  renderLibrary();
  renderAlbums();
  renderFavorites();

  // Prime the player queue with whatever is already in the library
  const all = Library.getSongs();
  if (all.length > 0) Player.setQueue(all, 0);

  console.log('%c🎵 Phai Music ready', 'color:#c4a8f7;font-weight:700;font-size:14px');
}

// ════════════════════════════════════════════════════════════
//  EVENT BINDING
// ════════════════════════════════════════════════════════════
function _bindEvents() {

  // ── Tab navigation ─────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ── File picker (add music) ────────────────────────────────
  const fileInput  = document.getElementById('file-input');
  const addBtn     = document.getElementById('add-music-btn');
  const addCta     = document.getElementById('add-music-cta');

  if (addBtn) addBtn.addEventListener('click', () => fileInput?.click());
  if (addCta) addCta.addEventListener('click', () => fileInput?.click());

  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      if (files.length) _handleFilesAdded(files);
      fileInput.value = '';  // allow re-selecting same files later
    });
  }

  // ── Mini-player ────────────────────────────────────────────

  // Tapping the center area opens the full player overlay
  const center = document.getElementById('mini-player-center');
  if (center) {
    center.addEventListener('click', () => {
      if (App.currentSong) UI.openPlayer();
    });
    center.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (App.currentSong) UI.openPlayer(); }
    });
  }

  _on('mini-play-btn',   'click', e => { e.stopPropagation(); Player.togglePlay(); });
  _on('mini-prev-btn',   'click', e => { e.stopPropagation(); Player.prev(); });
  _on('mini-next-btn',   'click', e => { e.stopPropagation(); Player.next(); });

  _on('mini-shuffle-btn', 'click', e => {
    e.stopPropagation();
    const on = Player.toggleShuffle();
    UI.updateShuffleBtn(on);
    if (App.currentSong) {
      UI.updateFullPlayer(App.currentSong, Player.isPlaying, Library.isFav(App.currentSong.id));
    }
  });

  _on('mini-fav-btn', 'click', e => {
    e.stopPropagation();
    _toggleFav();
  });

  // ── Full player overlay ────────────────────────────────────

  _on('player-close-btn', 'click', () => UI.closePlayer());

  _on('player-play-btn',  'click', () => Player.togglePlay());
  _on('player-prev-btn',  'click', () => Player.prev());
  _on('player-next-btn',  'click', () => Player.next());

  _on('player-fav-btn', 'click', () => _toggleFav());

  _on('player-shuffle-btn', 'click', () => {
    const on = Player.toggleShuffle();
    UI.updateShuffleBtn(on);
    if (App.currentSong) {
      UI.updateFullPlayer(App.currentSong, Player.isPlaying, Library.isFav(App.currentSong.id));
    }
  });

  _on('player-repeat-btn', 'click', () => {
    const on = Player.toggleRepeat();
    UI.updateRepeatBtn(on);
    UI.toast(on ? '🔁 Repeat on' : 'Repeat off');
  });

  // ── Progress bar ───────────────────────────────────────────
  const track = document.getElementById('progress-bar-container');
  if (track) {
    // Mouse click
    track.addEventListener('click', e => {
      const rect = track.getBoundingClientRect();
      const pct  = ((e.clientX - rect.left) / rect.width) * 100;
      Player.seekPct(Math.max(0, Math.min(100, pct)));
    });

    // Touch scrub
    let _scrubbing = false;
    const _scrub   = e => {
      if (!_scrubbing) return;
      const rect  = track.getBoundingClientRect();
      const touch = e.touches[0];
      const pct   = ((touch.clientX - rect.left) / rect.width) * 100;
      Player.seekPct(Math.max(0, Math.min(100, pct)));
    };
    track.addEventListener('touchstart', () => { _scrubbing = true; },  { passive: true });
    track.addEventListener('touchend',   () => { _scrubbing = false; }, { passive: true });
    track.addEventListener('touchmove',  _scrub, { passive: true });
  }

  // ── Volume slider ──────────────────────────────────────────
  _on('volume-slider', 'input', e => Player.setVolume(+e.target.value));

  // ── Theme button & Theme Modal ────────────────────────────
  _on('theme-btn', 'click', () => {
    UI.openThemeModal();
  });

  _on('theme-modal-close-btn', 'click', UI.closeThemeModal);
  _on('theme-modal', 'click', e => {
    if (e.target === document.getElementById('theme-modal')) UI.closeThemeModal();
  });

  document.querySelectorAll('.theme-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const theme = chip.dataset.theme;
      Library.setTheme(theme);
      UI.applyUserTheme(theme);
      document.querySelectorAll('.theme-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.theme === theme);
      });
      UI.toast(`🎨 Theme: ${chip.textContent.trim()}`);
      setTimeout(() => UI.closeThemeModal(), 280);
    });
  });

  // ── Edit metadata & menu buttons ──────────────────────────
  const _openEdit = () => {
    App.editingSongId = App.currentSong ? App.currentSong.id : null;
    App.pendingCover  = null;
    UI.openEditModal(App.currentSong);
  };
  _on('edit-metadata-btn', 'click', _openEdit);
  _on('player-more-btn',     'click', _openEdit);

  // Next song preview box click -> skip to next
  _on('player-next-art', 'click', () => Player.next());
  _on('player-next-art', 'keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Player.next(); }
  });

  // Close modal
  _on('modal-close-btn',  'click', UI.closeEditModal);
  _on('modal-cancel-btn', 'click', UI.closeEditModal);
  // Close when clicking the backdrop
  _on('edit-modal', 'click', e => {
    if (e.target === document.getElementById('edit-modal')) UI.closeEditModal();
  });

  // Save changes
  _on('modal-save-btn', 'click', _saveMetadata);

  // Delete song from storage
  _on('modal-delete-song-btn', 'click', _deleteCurrentSong);

  // Cover file picker inside the modal
  const coverPickerBtn  = document.getElementById('cover-picker-btn');
  const coverFileInput  = document.getElementById('cover-file-input');
  if (coverPickerBtn) {
    coverPickerBtn.addEventListener('click',  () => coverFileInput?.click());
    coverPickerBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); coverFileInput?.click(); }
    });
  }
  if (coverFileInput) {
    coverFileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      App.pendingCover = await _compressImage(file, 380, 0.82);
      const prevImg = document.getElementById('cover-preview-img');
      const prevPH  = document.getElementById('cover-picker-placeholder');
      if (prevImg) { prevImg.src = App.pendingCover; prevImg.classList.remove('hidden'); }
      if (prevPH)  { prevPH.classList.add('hidden'); }
      coverFileInput.value = '';
    });
  }

  // ── Library search ─────────────────────────────────────────
  const searchInput = document.getElementById('library-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q       = searchInput.value;
      const results = Library.search(q);
      _renderSongList(document.getElementById('library-list'), results, {
        icon: '🔍', title: 'No results', desc: 'Try a different keyword',
      });
      const countEl = document.getElementById('song-count');
      if (countEl) countEl.textContent = `${results.length} song${results.length !== 1 ? 's' : ''}`;
    });
  }

  // ── Album Creation & Modal Events ─────────────────────────
  const _openNewAlbum = () => {
    App.editingAlbumId = null;
    App.pendingAlbumCover = null;
    UI.openAlbumModal();
  };
  _on('albums-empty-box', 'click', _openNewAlbum);
  _on('fab-create-album', 'click', _openNewAlbum);

  _on('album-modal-close-btn',  'click', UI.closeAlbumModal);
  _on('album-modal-cancel-btn', 'click', UI.closeAlbumModal);
  _on('album-modal', 'click', e => {
    if (e.target === document.getElementById('album-modal')) UI.closeAlbumModal();
  });

  // Select all / Deselect all in Album Modal
  _on('album-select-all-btn', 'click', () => {
    const list = document.getElementById('album-song-picker-list');
    if (!list) return;
    const boxes = Array.from(list.querySelectorAll('input[type="checkbox"]'));
    boxes.slice(0, 50).forEach(cb => { cb.checked = true; cb.disabled = false; });
    boxes.slice(50).forEach(cb => { cb.checked = false; cb.disabled = true; });
    const countEl = document.getElementById('album-select-count');
    if (countEl) countEl.textContent = `Tanlangan: ${Math.min(50, boxes.length)} / 50`;
  });

  _on('album-deselect-all-btn', 'click', () => {
    const list = document.getElementById('album-song-picker-list');
    if (!list) return;
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      cb.disabled = false;
    });
    const countEl = document.getElementById('album-select-count');
    if (countEl) countEl.textContent = 'Tanlangan: 0 / 50';
  });

  // Cover file picker for albums
  const albumCoverBtn   = document.getElementById('album-cover-picker-btn');
  const albumCoverInput = document.getElementById('album-cover-file-input');
  if (albumCoverBtn) {
    albumCoverBtn.addEventListener('click',  () => albumCoverInput?.click());
    albumCoverBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); albumCoverInput?.click(); }
    });
  }
  if (albumCoverInput) {
    albumCoverInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      App.pendingAlbumCover = await _compressImage(file, 380, 0.82);
      const prevImg = document.getElementById('album-cover-preview-img');
      const prevPH  = document.getElementById('album-cover-picker-placeholder');
      if (prevImg) { prevImg.src = App.pendingAlbumCover; prevImg.classList.remove('hidden'); }
      if (prevPH)  { prevPH.classList.add('hidden'); }
      albumCoverInput.value = '';
    });
  }

  // Save Album
  _on('album-modal-save-btn', 'click', _saveAlbum);

  // Play All & Delete Album
  _on('album-play-all-btn', 'click', _playCurrentAlbum);
  _on('album-delete-btn',   'click', _deleteCurrentAlbum);

  // ── Swipe-down to close player ─────────────────────────────
  _bindSwipeClose();
}

// ── Small helper: attach a click listener by element ID ──────
function _on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ════════════════════════════════════════════════════════════
//  SWIPE-DOWN TO CLOSE FULL PLAYER
// ════════════════════════════════════════════════════════════
function _bindSwipeClose() {
  const overlay = document.getElementById('player-overlay');
  if (!overlay) return;

  let _startY = 0;
  let _active = false;

  overlay.addEventListener('touchstart', e => {
    _startY = e.touches[0].clientY;
    _active = true;
    overlay.style.transition = 'none';  // disable CSS transition during drag
  }, { passive: true });

  overlay.addEventListener('touchmove', e => {
    if (!_active) return;
    const dy = e.touches[0].clientY - _startY;
    if (dy > 0) overlay.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  overlay.addEventListener('touchend', e => {
    if (!_active) return;
    _active = false;
    overlay.style.transition = '';   // restore CSS transition

    const dy = e.changedTouches[0].clientY - _startY;
    if (dy > 110) {
      // Swiped far enough — close
      overlay.style.transform = '';
      UI.closePlayer();
    } else {
      // Snap back
      overlay.style.transform = '';
    }
  }, { passive: true });
}

// ════════════════════════════════════════════════════════════
//  VIEW SWITCHING
// ════════════════════════════════════════════════════════════
function switchView(viewName) {
  App.currentView = viewName;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Show / hide views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  });

  // Update header title
  const TITLES = { home: 'Phai Music', library: 'My Library', albums: 'Albums', favorites: 'Liked Songs' };
  const hTitle = document.getElementById('header-title');
  const hLogo  = document.getElementById('header-custom-logo');
  const isBlazing = document.body.classList.contains('theme-blazing-sun');

  if (viewName === 'home' && isBlazing) {
    if (hTitle) hTitle.classList.add('hidden');
    if (hLogo)  hLogo.classList.remove('hidden');
  } else {
    if (hTitle) {
      hTitle.textContent = TITLES[viewName] || 'Phai Music';
      hTitle.classList.remove('hidden');
    }
    if (hLogo)  hLogo.classList.add('hidden');
  }

  if (viewName === 'albums') renderAlbums();
}

// ════════════════════════════════════════════════════════════
//  FILE HANDLING
// ════════════════════════════════════════════════════════════
function _handleFilesAdded(files) {
  const added = Library.addSongs(files);

  if (added.length === 0) {
    UI.toast('No new audio files found');
    return;
  }

  UI.toast(`✅ Added ${added.length} song${added.length !== 1 ? 's' : ''}`);

  // Refresh all rendered lists
  renderHome();
  renderLibrary();
  renderFavorites();

  // Rebuild player queue (keeps shuffle state)
  const all    = Library.getSongs();
  const newIdx = Library.getSongIndex(added[0].id);
  Player.setQueue(all, Math.max(0, newIdx));

  // Auto-play the first newly added song if nothing is playing yet
  if (!Player.isPlaying) {
    Player.playById(added[0].id);
  }
}

// ════════════════════════════════════════════════════════════
//  PLAYER CALLBACKS
// ════════════════════════════════════════════════════════════
function _handleSongChange(song) {
  App.currentSong = song;

  Library.addRecent(song.id);

  const isFav = Library.isFav(song.id);

  UI.updateMiniPlayer(song, true, isFav);
  UI.updateFullPlayer(song, true, isFav);
  UI.applyTheme(song);
  UI.highlightSong(song.id);

  // Refresh "Recently Played" section on Home
  _renderRecentlyPlayed();
}

function _handlePlayChange(isPlaying) {
  UI.updatePlayIcons(isPlaying);
}

function _handleProgress(cur, dur) {
  UI.updateProgress(cur, dur);
}

// ════════════════════════════════════════════════════════════
//  FAVORITES TOGGLE
// ════════════════════════════════════════════════════════════
function _toggleFav() {
  if (!App.currentSong) return;

  const isFav = Library.toggleFav(App.currentSong.id);
  UI.updateHeartBtns(isFav);
  UI.animateHeart();

  renderFavorites();  // refresh Liked tab
}

// ════════════════════════════════════════════════════════════
//  METADATA SAVE
// ════════════════════════════════════════════════════════════
function _saveMetadata() {
  const id = App.editingSongId;
  if (!id) return;

  const titleVal  = document.getElementById('edit-title-input')?.value.trim();
  const artistVal = document.getElementById('edit-artist-input')?.value.trim();

  const updates = {};
  if (titleVal)       updates.title  = titleVal;
  if (artistVal)      updates.artist = artistVal;
  if (App.pendingCover) updates.cover = App.pendingCover;

  if (Object.keys(updates).length === 0) {
    UI.closeEditModal();
    return;
  }

  Library.updateMeta(id, updates);

  // Reflect changes on the currently playing song immediately
  if (App.currentSong?.id === id) {
    const song = Library.getSongById(id);
    if (song) {
      App.currentSong = song;
      UI.updateMiniPlayer(song, Player.isPlaying, Library.isFav(id));
      UI.updateFullPlayer(song, Player.isPlaying, Library.isFav(id));
      UI.applyTheme(song);
    }
  }

  UI.closeEditModal();
  UI.toast('✅ Changes saved!');

  // Re-render lists so updated title / art appear
  renderHome();
  renderLibrary();
  renderFavorites();
}

async function _deleteCurrentSong() {
  const id = App.editingSongId || App.currentSong?.id;
  if (!id) return;
  const song = Library.getSongById(id);
  const songTitle = song ? song.title : 'this song';

  const ok = await UI.confirmDialog(
    'Delete Track',
    `"${songTitle}" xotiradan to'liq o'chirilsinmi?`,
    'Delete'
  );

  if (!ok) return;

  // Delete from Library, localStorage and IndexedDB
  Library.removeSong(id);

  // Close modal
  UI.closeEditModal();

  // If this song was currently playing
  if (App.currentSong?.id === id) {
    const remaining = Library.getSongs();
    if (remaining.length > 0) {
      Player.setQueue(remaining, 0);
      Player.playById(remaining[0].id);
    } else {
      App.currentSong = null;
      Player.setQueue([], 0);
      UI.closePlayer();
      const mini = document.getElementById('mini-player');
      if (mini) mini.classList.remove('visible');
    }
  }

  // Re-render all views
  renderHome();
  renderLibrary();
  renderAlbums();
  renderFavorites();

  UI.toast('🗑️ Musiqa xotiradan o\'chirildi');
}

// ════════════════════════════════════════════════════════════
//  RENDER HELPERS
// ════════════════════════════════════════════════════════════

/** Play a song and rebuild the queue so it's the current track. */
function _play(song) {
  const all = Library.getSongs();
  Player.setQueue(all, Library.getSongIndex(song.id));
  Player.playById(song.id);
}

// ── Home ──────────────────────────────────────────────────────
function renderHome() {
  _renderRecentlyPlayed();
  _renderFeatured();
}

function _renderRecentlyPlayed() {
  const container = document.getElementById('recently-played-list');
  if (!container) return;
  container.innerHTML = '';

  const songs = Library.getRecent();
  if (songs.length === 0) {
    container.innerHTML = `
      <div class="empty-h">
        <span class="empty-h-icon">🎵</span>
        <p>No recently played</p>
      </div>`;
    return;
  }

  songs.forEach(song => {
    const card = UI.buildRecentCard(
      song,
      App.currentSong?.id === song.id,
      s => _play(s)
    );
    container.appendChild(card);
  });
}

function _renderFeatured() {
  const container = document.getElementById('featured-list');
  const emptyEl   = document.getElementById('featured-empty');
  if (!container) return;

  const songs = Library.getSongs();

  if (songs.length === 0) {
    // Show only the empty CTA
    container.innerHTML = '';
    if (emptyEl) container.appendChild(emptyEl);
    emptyEl?.classList.remove('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  _renderSongList(container, songs);
}

// ── Albums ──────────────────────────────────────────────────
function renderAlbums() {
  const albums = Library.getAlbums();
  const emptyBox = document.getElementById('albums-empty-box');
  const content = document.getElementById('albums-content');
  const carousel = document.getElementById('albums-carousel');
  const songList = document.getElementById('album-songs-list');
  const titleEl = document.getElementById('adh-title');
  const subEl = document.getElementById('adh-sub');

  if (albums.length === 0) {
    if (emptyBox) emptyBox.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    return;
  }

  if (emptyBox) emptyBox.classList.add('hidden');
  if (content) content.classList.remove('hidden');

  // Verify selected album
  if (!App.selectedAlbumId || !Library.getAlbumById(App.selectedAlbumId)) {
    App.selectedAlbumId = albums[0].id;
  }

  // Render carousel
  if (carousel) {
    carousel.innerHTML = '';
    albums.forEach(album => {
      const isSelected = album.id === App.selectedAlbumId;
      const card = UI.buildAlbumCard(album, isSelected);

      // Select album on card tap
      card.addEventListener('click', e => {
        if (e.target.closest('.ac-play-btn')) return; // handled separately
        App.selectedAlbumId = album.id;
        renderAlbums();
      });

      // Play album on floating play button tap
      const playBtn = card.querySelector('.ac-play-btn');
      if (playBtn) {
        playBtn.addEventListener('click', e => {
          e.stopPropagation();
          App.selectedAlbumId = album.id;
          _playCurrentAlbum();
        });
      }

      carousel.appendChild(card);
    });
  }

  // Render selected album details
  const selAlbum = Library.getAlbumById(App.selectedAlbumId);
  if (selAlbum) {
    if (titleEl) titleEl.textContent = selAlbum.name;
    const albumSongs = Library.getAlbumSongs(selAlbum.id);
    if (subEl) subEl.textContent = `${albumSongs.length} ta musiqa`;

    if (songList) {
      songList.innerHTML = '';
      if (albumSongs.length === 0) {
        songList.innerHTML = '<p class="empty-hint" style="padding:16px 0;">Bu albomda musiqalar yo\'q.</p>';
      } else {
        albumSongs.forEach((song, idx) => {
          const item = UI.buildAlbumSongItem(song, idx);
          if (App.currentSong?.id === song.id) item.classList.add('playing');
          item.addEventListener('click', () => {
            Player.setQueue(albumSongs, idx);
            Player.playById(song.id);
          });
          songList.appendChild(item);
        });
      }
    }
  }
}

function _saveAlbum() {
  const nameInp = document.getElementById('album-name-input');
  const name = nameInp ? nameInp.value.trim() : '';

  const checkedBoxes = Array.from(document.querySelectorAll('#album-song-picker-list input[type="checkbox"]:checked'));
  const songIds = checkedBoxes.map(cb => cb.value).slice(0, 50);

  if (App.editingAlbumId) {
    Library.updateAlbum(App.editingAlbumId, {
      name: name || 'Album',
      cover: App.pendingAlbumCover || undefined,
      songIds,
    });
    UI.toast('✅ Albom yangilandi!');
  } else {
    const created = Library.createAlbum(name || 'New Album', App.pendingAlbumCover || '', songIds);
    App.selectedAlbumId = created.id;
    UI.toast('✅ Yangi albom yaratildi!');
  }

  UI.closeAlbumModal();
  renderAlbums();
}

function _playCurrentAlbum() {
  if (!App.selectedAlbumId) return;
  const songs = Library.getAlbumSongs(App.selectedAlbumId);
  if (songs.length === 0) {
    UI.toast('Albomda musiqa yo\'q');
    return;
  }
  Player.setQueue(songs, 0);
  Player.playById(songs[0].id);
  UI.toast(`▶ "${Library.getAlbumById(App.selectedAlbumId)?.name}" yangramoqda`);
}

async function _deleteCurrentAlbum() {
  if (!App.selectedAlbumId) return;
  const album = Library.getAlbumById(App.selectedAlbumId);
  if (!album) return;
  const ok = await UI.confirmDialog(
    'Delete Album',
    `"${album.name}" albomini o'chirishni xohlaysizmi?`,
    'Delete'
  );
  if (ok) {
    Library.deleteAlbum(album.id);
    App.selectedAlbumId = null;
    UI.toast('Albom o\'chirildi');
    renderAlbums();
  }
}

// ── Library ───────────────────────────────────────────────────
function renderLibrary() {
  const songs   = Library.getSongs();
  const countEl = document.getElementById('song-count');
  if (countEl) countEl.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''}`;

  _renderSongList(document.getElementById('library-list'), songs, {
    icon: '📂', title: 'Library is empty', desc: 'Tap + to import your audio files',
  });
}

// ── Favorites ─────────────────────────────────────────────────
function renderFavorites() {
  _renderSongList(document.getElementById('favorites-list'), Library.getFavs(), {
    icon: '❤️', title: 'No liked songs', desc: 'Tap ❤️ on any track to save it here',
  });
}

// ── Generic song-list renderer ────────────────────────────────
/**
 * Populates a .song-list container with song items.
 * @param {Element} container
 * @param {Song[]}  songs
 * @param {{ icon, title, desc }} emptyConfig  - shown when list is empty
 */
function _renderSongList(container, songs, emptyConfig = {}) {
  if (!container) return;
  container.innerHTML = '';

  if (songs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">${emptyConfig.icon  || '🎵'}</div>
        <h3>${emptyConfig.title || 'No songs'}</h3>
        <p>${emptyConfig.desc  || ''}</p>
      </div>`;
    return;
  }

  songs.forEach(song => {
    const item = UI.buildSongItem(
      song,
      App.currentSong?.id === song.id,
      s => _play(s)
    );
    container.appendChild(item);
  });
}
