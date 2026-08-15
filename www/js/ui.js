/**
 * PHAI MUSIC — js/ui.js
 * ============================================================
 * Responsible for ALL DOM updates.  Nothing in this file makes
 * audio decisions — it only reads state and paints the screen.
 *
 * Key responsibilities:
 *  • Render song cards / list items
 *  • Update mini-player bar
 *  • Update full-player overlay
 *  • Dynamic accent color extraction from album art
 *  • Toast notifications
 *  • Modal open / close
 * ============================================================
 */

const UI = (() => {

  // ══ HELPERS ════════════════════════════════════════════════

  /** Escape a string for safe insertion into HTML. */
  function esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
  }

  /** Format seconds → "M:SS" */
  function fmtTime(secs) {
    if (!isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  /** Get time-appropriate greeting. */
  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // ══ COLOR EXTRACTION (Material You / Content-Based) ════════
  /**
   * RGB to HSL conversion helper.
   */
  function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  function _makePaletteFromHsl(h, s, l) {
    return {
      primary:      `hsl(${h}, ${s}%, ${l}%)`,
      primaryDark:  `hsl(${h}, ${s}%, ${Math.max(15, l - 25)}%)`,
      blush:        `hsl(${h}, ${Math.max(45, s - 10)}%, ${Math.min(88, l + 18)}%)`,
      blushHi:      `hsl(${h}, ${Math.max(45, s - 10)}%, ${Math.min(94, l + 26)}%)`,
      blushDark:    `hsl(${h}, ${s}%, ${Math.max(25, l - 12)}%)`,
      appBg:        `hsl(${h}, 22%, 5%)`,
      appSurface:   `hsl(${h}, 18%, 10%)`,
      bgGradient:   `radial-gradient(circle at 40% 25%, hsl(${h}, ${s}%, 26%) 0%, transparent 65%)`,
    };
  }

  /**
   * Extract vibrant dominant color palette from cover image.
   * Samples pixels across 36x36 canvas and bins by hue.
   */
  function _extractColorPalette(imgEl, fallbackStr = '') {
    return new Promise(resolve => {
      try {
        if (!imgEl) throw new Error('No image');
        const canvas = document.createElement('canvas');
        canvas.width  = 36;
        canvas.height = 36;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, 36, 36);
        const { data } = ctx.getImageData(0, 0, 36, 36);

        // 12 Hue bins (0-30, 30-60, ..., 330-360)
        const bins = Array.from({ length: 12 }, () => ({ count: 0, maxSat: 0, h: 0, s: 0, l: 0 }));

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          const [h, s, l] = _rgbToHsl(r, g, b);
          // Filter out near-black, near-white, or completely washed out greys
          if (l < 15 || l > 88 || s < 18) continue;

          const binIdx = Math.floor(h / 30) % 12;
          const bin = bins[binIdx];
          bin.count++;
          if (s > bin.maxSat) {
            bin.maxSat = s;
            bin.h = h;
            bin.s = s;
            bin.l = l;
          }
        }

        const validBins = bins.filter(b => b.count > 0);
        if (validBins.length === 0) throw new Error('Low saturation');

        // Score bins: prioritize vibrancy and pleasant saturation/lightness
        validBins.sort((a, b) => {
          const scoreA = (a.s * 1.6) + (a.count * 0.4) - Math.abs(a.l - 55);
          const scoreB = (b.s * 1.6) + (b.count * 0.4) - Math.abs(b.l - 55);
          return scoreB - scoreA;
        });

        const best = validBins[0];
        const h = best.h;
        const s = Math.max(50, Math.min(88, best.s));
        const l = Math.max(48, Math.min(68, best.l));

        resolve(_makePaletteFromHsl(h, s, l));
      } catch (_) {
        // Deterministic rich fallback based on title/artist text
        let hash = 265;
        if (fallbackStr) {
          for (let i = 0; i < fallbackStr.length; i++) {
            hash = (hash * 31 + fallbackStr.charCodeAt(i)) % 360;
          }
        }
        resolve(_makePaletteFromHsl(hash, 70, 60));
      }
    });
  }

  /**
   * Apply dynamic content-based theme colour based on the current song's cover.
   * - Mini-player center pill ALWAYS reflects the album art color (regardless of active theme).
   * - If theme is 'content', full app palette harmonizes with the album art.
   * - If song is "Blazing Sun", activates secret hidden theme!
   */
  async function applyTheme(song) {
    const isBlazing = Boolean(song && song.title && song.title.toLowerCase().includes('blazing sun'));

    if (isBlazing) {
      document.body.classList.add('theme-blazing-sun');
      const curView = document.querySelector('.tab-btn.active')?.dataset?.view || 'home';
      if (curView === 'home') {
        _toggleHidden('header-title', true);
        _toggleHidden('header-custom-logo', false);
      }
      _toggleHidden('player-prev-icon', true);
      _toggleHidden('player-custom-prev-img', false);
      _toggleHidden('player-next-icon', true);
      _toggleHidden('player-custom-next-img', false);
    } else {
      document.body.classList.remove('theme-blazing-sun');
      _toggleHidden('header-title', false);
      _toggleHidden('header-custom-logo', true);
      _toggleHidden('player-prev-icon', false);
      _toggleHidden('player-custom-prev-img', true);
      _toggleHidden('player-next-icon', false);
      _toggleHidden('player-custom-next-img', true);
    }

    let palette = _makePaletteFromHsl(265, 70, 60);

    if (song) {
      if (song.cover) {
        const tmp = new Image();
        tmp.src = song.cover;
        await new Promise(res => {
          tmp.onload  = res;
          tmp.onerror = res;
          setTimeout(res, 600);
        });
        palette = await _extractColorPalette(tmp, `${song.title} ${song.artist}`);
      } else {
        palette = await _extractColorPalette(null, `${song.title} ${song.artist}`);
      }
    }

    // 1. ALWAYS update the mini-player center pill background with content-based color
    const center = document.getElementById('mini-player-center');
    if (center) {
      center.style.background = palette.primary;
      center.style.boxShadow = `0 6px 28px ${palette.primary}55`;
    }

    // 2. Set --dyn-accent on :root
    document.documentElement.style.setProperty('--dyn-accent', palette.primary);

    // 3. If active theme is 'content' (and not in blazing sun override), adapt full app palette!
    const activeTheme = typeof Library !== 'undefined' && Library.getTheme ? Library.getTheme() : 'content';
    if (activeTheme === 'content' && !isBlazing) {
      document.documentElement.style.setProperty('--blush',      palette.blush);
      document.documentElement.style.setProperty('--blush-hi',   palette.blushHi);
      document.documentElement.style.setProperty('--blush-drk',  palette.blushDark);
      document.documentElement.style.setProperty('--bg-0',       palette.appBg);
      document.documentElement.style.setProperty('--bg-1',       palette.appSurface);

      const bg = document.getElementById('player-bg');
      if (bg) bg.style.background = palette.bgGradient;
    }

    // 4. Glow on Now Playing album art frame
    const frame = document.getElementById('player-art-frame');
    if (frame) {
      const glowColor = isBlazing ? '#ffd152' : palette.primary;
      frame.style.boxShadow = `0 20px 50px rgba(0,0,0,.8), 0 0 45px ${glowColor}55, 0 0 0 1px rgba(255,255,255,.06)`;
    }
  }

  // ══ ALBUM ART HTML ═════════════════════════════════════════
  /** Returns inner HTML for an art container (img OR placeholder). */
  function _artInner(song, svgSize = 22) {
    const NOTE_SVG = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
           style="width:${svgSize}px;height:${svgSize}px">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>`;

    if (song && song.cover) {
      return `<img src="${esc(song.cover)}" alt="" loading="lazy" />`;
    }
    return `<div class="si-art-ph">${NOTE_SVG}</div>`;
  }

  // ══ RECENTLY-PLAYED CARD ═══════════════════════════════════
  /**
   * Build a .rc-card element.
   * @param {object} song
   * @param {boolean} isActive  - true if this is the current song
   * @param {function} onClick  - callback(song)
   */
  function buildRecentCard(song, isActive, onClick) {
    const card = document.createElement('div');
    card.className = 'rc-card';
    card.dataset.songId = song.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${song.title} by ${song.artist}`);

    const NOTE_SVG = `
      <div class="rc-art-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      </div>`;

    card.innerHTML = `
      <div class="rc-art">
        ${song.cover
          ? `<img src="${esc(song.cover)}" alt="" loading="lazy" />`
          : NOTE_SVG}
        <div class="rc-play-overlay" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="rc-title">${esc(song.title)}</div>
      <div class="rc-artist">${esc(song.artist)}</div>
    `;

    card.addEventListener('click', () => onClick(song));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(song); }
    });
    return card;
  }

  // ══ SONG LIST ITEM ═════════════════════════════════════════
  /**
   * Build a .song-item element for the vertical song lists.
   * @param {object}   song
   * @param {boolean}  isPlaying  - highlight if true
   * @param {function} onClick    - callback(song)
   */
  function buildSongItem(song, isPlaying, onClick) {
    const item = document.createElement('div');
    item.className = `song-item${isPlaying ? ' playing' : ''}`;
    item.dataset.songId = song.id;
    item.setAttribute('role', 'listitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `${song.title} by ${song.artist}${isPlaying ? ', now playing' : ''}`);

    const NOTE_SVG = `
      <div class="si-art-ph">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      </div>`;

    item.innerHTML = `
      <div class="si-art">
        ${song.cover ? `<img src="${esc(song.cover)}" alt="" loading="lazy" />` : NOTE_SVG}
      </div>
      <div class="si-info">
        <div class="si-title">${esc(song.title)}</div>
        <div class="si-artist">${esc(song.artist)}</div>
      </div>
    `;

    item.addEventListener('click', () => onClick(song));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(song); }
    });

    return item;
  }

  // ══ MINI-PLAYER BAR ════════════════════════════════════════

  /** Update everything in the mini-player pill. */
  function updateMiniPlayer(song, isPlaying, isFav) {
    // Title
    const titleEl = document.getElementById('mini-song-title');
    if (titleEl) titleEl.textContent = song ? song.title : 'No song playing';

    // Album art
    const img         = document.getElementById('mini-album-img');
    const placeholder = document.getElementById('mini-art-placeholder');
    if (img && placeholder) {
      if (song && song.cover) {
        img.src = song.cover;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }
    }

    updatePlayIcons(isPlaying);
    updateHeartBtns(isFav);
  }

  // ══ PLAY / PAUSE ICONS ═════════════════════════════════════

  function updatePlayIcons(isPlaying) {
    // Mini-player (always standard SVGs)
    _toggleHidden('mini-play-icon',  isPlaying);
    _toggleHidden('mini-pause-icon', !isPlaying);

    // Full player: check if Blazing Sun secret theme is active
    const isBlazing = document.body.classList.contains('theme-blazing-sun');
    if (isBlazing) {
      _toggleHidden('player-play-icon', true);
      _toggleHidden('player-pause-icon', true);
      // When playing -> pause button is 'phai dot'
      // When paused  -> play button is 'phai u'
      _toggleHidden('player-custom-pause-img', !isPlaying);
      _toggleHidden('player-custom-play-img', isPlaying);
    } else {
      _toggleHidden('player-custom-play-img', true);
      _toggleHidden('player-custom-pause-img', true);
      _toggleHidden('player-play-icon',  isPlaying);
      _toggleHidden('player-pause-icon', !isPlaying);
    }

    // Vinyl ring spin
    const ring = document.getElementById('po-vinyl-ring');
    if (ring) ring.classList.toggle('spinning', isPlaying);
  }

  function _toggleHidden(id, shouldHide) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', shouldHide);
  }

  // ══ HEART / FAV BUTTONS ════════════════════════════════════

  function updateHeartBtns(isFav) {
    // Mini-player side button
    const miniBtn = document.getElementById('mini-fav-btn');
    if (miniBtn) {
      miniBtn.classList.toggle('fav-on', isFav);
      const heartSvg = document.getElementById('mini-heart-icon');
      if (heartSvg) heartSvg.style.fill = isFav ? 'var(--a-pink)' : 'none';
    }

    // Full-player button (blush-pink circle)
    const fullBtn = document.getElementById('player-fav-btn');
    if (fullBtn) fullBtn.classList.toggle('fav-active', isFav);
    const fullHeart = document.getElementById('player-heart-icon');
    if (fullHeart) {
      fullHeart.style.fill   = isFav ? '#1a080c' : 'none';
      fullHeart.style.stroke = '#1a080c';
    }
  }

  function animateHeart() {
    ['mini-fav-btn', 'player-fav-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('hb-animate');
      void el.offsetWidth;   // force reflow
      el.classList.add('hb-animate');
      el.addEventListener('animationend', () => el.classList.remove('hb-animate'), { once: true });
    });
  }

  // ══ SHUFFLE / REPEAT BUTTONS ═══════════════════════════════

  function updateShuffleBtn(on) {
    ['mini-shuffle-btn', 'player-shuffle-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle('shuffle-on', on);
        el.classList.toggle('ctrl-active', on);
        el.setAttribute('aria-pressed', String(on));
      }
    });
  }

  function updateRepeatBtn(on) {
    const el = document.getElementById('player-repeat-btn');
    if (el) {
      el.classList.toggle('ctrl-active', on);
      el.setAttribute('aria-pressed', String(on));
    }
  }

  // ══ FULL PLAYER ════════════════════════════════════════════

  function updateFullPlayer(song, isPlaying, isFav) {
    if (!song) return;

    // Title & artist
    const t = document.getElementById('player-song-title');
    const a = document.getElementById('player-song-artist');
    if (t) t.textContent = song.title;
    if (a) a.textContent = song.artist;

    // Main Album art
    const artImg = document.getElementById('player-album-art');
    const artPH  = document.getElementById('player-art-placeholder');
    if (artImg && artPH) {
      if (song.cover) {
        artImg.src = song.cover;
        artImg.classList.remove('hidden');
        artPH.classList.add('hidden');
      } else {
        artImg.classList.add('hidden');
        artPH.classList.remove('hidden');
      }
    }

    // Next Track Section
    const nextSong = Player.nextSong ? Player.nextSong() : null;
    const nextTitle = document.getElementById('player-next-title');
    const nextImg   = document.getElementById('player-next-art-img');
    const nextPH    = document.getElementById('player-next-placeholder');

    if (nextTitle) {
      nextTitle.textContent = nextSong ? nextSong.title : 'End of queue';
    }
    if (nextImg && nextPH) {
      if (nextSong && nextSong.cover) {
        nextImg.src = nextSong.cover;
        nextImg.classList.remove('hidden');
        nextPH.classList.add('hidden');
      } else {
        nextImg.classList.add('hidden');
        nextPH.classList.remove('hidden');
      }
    }

    updatePlayIcons(isPlaying);
    updateHeartBtns(isFav);
  }

  // ══ PROGRESS BAR ═══════════════════════════════════════════

  function updateProgress(currentTime, duration) {
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

    const fill  = document.getElementById('progress-fill');
    const thumb = document.getElementById('progress-thumb');
    const cur   = document.getElementById('current-time');
    const tot   = document.getElementById('total-time');

    if (fill)  fill.style.width  = `${pct}%`;
    if (thumb) thumb.style.left  = `${pct}%`;
    if (cur)   cur.textContent   = fmtTime(currentTime);
    if (tot)   tot.textContent   = fmtTime(duration);

    // Update ARIA value on the progress track
    const track = document.getElementById('progress-bar-container');
    if (track) track.setAttribute('aria-valuenow', Math.round(pct));
  }

  // ══ SONG-ITEM HIGHLIGHTING ═════════════════════════════════

  /** Mark the currently playing song in all rendered lists. */
  function highlightSong(activeSongId) {
    document.querySelectorAll('.song-item').forEach(item => {
      const active = item.dataset.songId === activeSongId;
      item.classList.toggle('playing', active);
    });
  }

  // ══ PLAYER OVERLAY OPEN / CLOSE ════════════════════════════

  function openPlayer() {
    const ov = document.getElementById('player-overlay');
    if (ov) {
      ov.classList.add('open');
      ov.removeAttribute('aria-hidden');
    }
  }

  function closePlayer() {
    const ov = document.getElementById('player-overlay');
    if (ov) {
      ov.classList.remove('open');
      ov.setAttribute('aria-hidden', 'true');
    }
  }

  // ══ USER THEMES ═════════════════════════════════════════════

  function applyUserTheme(themeName) {
    const t = themeName || (typeof Library !== 'undefined' && Library.getTheme ? Library.getTheme() : 'content');
    document.documentElement.setAttribute('data-theme', t);

    // Update active state on modal theme chips
    document.querySelectorAll('.theme-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.theme === t);
    });

    if (t !== 'content') {
      // Remove inline overrides so static theme CSS applies to background & controls
      document.documentElement.style.removeProperty('--blush');
      document.documentElement.style.removeProperty('--blush-hi');
      document.documentElement.style.removeProperty('--blush-drk');
      document.documentElement.style.removeProperty('--bg-0');
      document.documentElement.style.removeProperty('--bg-1');
    }

    // Always extract & apply content-based album art color (especially for mini-player center pill)
    const song = typeof Player !== 'undefined' && Player.currentSong ? Player.currentSong() : null;
    applyTheme(song);
  }

  // ══ THEME MODAL ═════════════════════════════════════════════

  function openThemeModal() {
    const modal = document.getElementById('theme-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.remove('hidden');

    const curTheme = typeof Library !== 'undefined' && Library.getTheme ? Library.getTheme() : 'content';
    modal.querySelectorAll('.theme-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.theme === curTheme);
    });
  }

  function closeThemeModal() {
    const modal = document.getElementById('theme-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  // ══ EDIT MODAL OPEN / CLOSE ════════════════════════════════

  function openEditModal(song) {
    const modal = document.getElementById('edit-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.remove('hidden');

    // Pre-fill fields with current values (if a song is given)
    const titleInp  = document.getElementById('edit-title-input');
    const artistInp = document.getElementById('edit-artist-input');
    if (titleInp)  titleInp.value  = song ? song.title : '';
    if (artistInp) artistInp.value = song ? song.artist : '';

    // Cover preview
    const prevImg = document.getElementById('cover-preview-img');
    const prevPH  = document.getElementById('cover-picker-placeholder');
    if (prevImg && prevPH) {
      if (song && song.cover) {
        prevImg.src = song.cover;
        prevImg.classList.remove('hidden');
        prevPH.classList.add('hidden');
      } else {
        prevImg.classList.add('hidden');
        prevPH.classList.remove('hidden');
      }
    }
  }

  function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  // ══ CONFIRM DIALOG (Mobile Native Promise Modal) ───────────

  function confirmDialog(title, message, okText = 'Delete') {
    return new Promise(resolve => {
      const modal = document.getElementById('confirm-modal');
      const t = document.getElementById('confirm-title');
      const m = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      if (!modal) {
        resolve(window.confirm(message));
        return;
      }

      if (t) t.textContent = title;
      if (m) m.textContent = message;
      if (okBtn) okBtn.textContent = okText;

      modal.style.display = 'flex';
      modal.classList.remove('hidden');

      const cleanup = (res) => {
        modal.classList.add('hidden');
        modal.style.display = 'none';
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        resolve(res);
      };

      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };

      okBtn?.addEventListener('click', onOk, { once: true });
      cancelBtn?.addEventListener('click', onCancel, { once: true });
      modal.addEventListener('click', onBackdrop, { once: true });
    });
  }

  // ══ ALBUMS UI ══════════════════════════════════════════════

  function buildAlbumCard(album, isSelected = false) {
    const card = document.createElement('div');
    card.className = `album-card ${isSelected ? 'selected' : ''}`;
    card.dataset.albumId = album.id;

    const count = album.songIds ? album.songIds.length : 0;
    const coverHtml = album.cover
      ? `<img src="${album.cover}" alt="${esc(album.name)}" class="ac-img" />`
      : `<div class="ac-placeholder">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
             <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
           </svg>
         </div>`;

    card.innerHTML = `
      <div class="ac-cover-wrap">
        ${coverHtml}
        <div class="ac-overlay"></div>
        <div class="ac-info">
          <h4 class="ac-title">${esc(album.name)}</h4>
          <p class="ac-sub">${count} ta musiqa</p>
        </div>
        <button class="ac-play-btn" data-album-id="${album.id}" aria-label="Play album">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
    `;
    return card;
  }

  function buildAlbumSongItem(song, idx) {
    const item = document.createElement('div');
    item.className = 'song-item album-song-item';
    item.dataset.songId = song.id;

    const coverHtml = song.cover
      ? `<img src="${song.cover}" alt="" />`
      : `<div class="si-art-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;

    item.innerHTML = `
      <span class="asi-num">${idx + 1}</span>
      <div class="si-art">${coverHtml}</div>
      <div class="si-info">
        <p class="si-title">${esc(song.title)}</p>
        <p class="si-artist">${esc(song.artist)}</p>
      </div>
    `;
    return item;
  }

  // ══ ALBUM MODAL ════════════════════════════════════════════

  function openAlbumModal(album = null) {
    const modal = document.getElementById('album-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.remove('hidden');

    const nameInp = document.getElementById('album-name-input');
    const prevImg = document.getElementById('album-cover-preview-img');
    const prevPH  = document.getElementById('album-cover-picker-placeholder');
    const countEl = document.getElementById('album-select-count');
    const titleEl = document.getElementById('album-modal-title');

    if (titleEl) titleEl.textContent = album ? 'Albomni tahrirlash' : 'Yangi album yaratish';
    if (nameInp) nameInp.value = album ? album.name : '';

    if (prevImg && prevPH) {
      if (album && album.cover) {
        prevImg.src = album.cover;
        prevImg.classList.remove('hidden');
        prevPH.classList.add('hidden');
      } else {
        prevImg.src = '';
        prevImg.classList.add('hidden');
        prevPH.classList.remove('hidden');
      }
    }

    // Render songs checklist
    const listEl = document.getElementById('album-song-picker-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const allSongs = typeof Library !== 'undefined' ? Library.getSongs() : [];
    const selectedIds = new Set(album ? album.songIds : []);

    const updateCount = () => {
      const checkedCount = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
      if (countEl) countEl.textContent = `Tanlangan: ${checkedCount} / 50`;

      // Disable unchecked if 50 reached
      listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (!cb.checked) cb.disabled = checkedCount >= 50;
      });
    };

    if (allSongs.length === 0) {
      listEl.innerHTML = '<p class="empty-hint" style="padding:16px 0;text-align:center;color:var(--txt-lo);">Kutubxonada musiqalar mavjud emas. Avval + orqali musiqa qo\'shing.</p>';
      if (countEl) countEl.textContent = 'Tanlangan: 0 / 50';
      return;
    }

    allSongs.forEach(s => {
      const label = document.createElement('label');
      label.className = 'album-picker-item';
      const isChecked = selectedIds.has(s.id);

      label.innerHTML = `
        <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''} class="custom-checkbox" />
        <div class="api-thumb">${s.cover ? `<img src="${s.cover}" />` : '🎵'}</div>
        <div class="api-info">
          <span class="api-title">${esc(s.title)}</span>
          <span class="api-artist">${esc(s.artist)}</span>
        </div>
      `;

      label.querySelector('input').addEventListener('change', updateCount);
      listEl.appendChild(label);
    });

    updateCount();
  }

  function closeAlbumModal() {
    const modal = document.getElementById('album-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  // ══ TOAST ══════════════════════════════════════════════════

  function toast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className   = 'toast';
    el.textContent = msg;
    container.appendChild(el);

    // Remove after animation ends (~2.6 s total)
    setTimeout(() => el.remove(), 2600);
  }

  // ══ PUBLIC API ═════════════════════════════════════════════
  return {
    greeting,
    fmtTime,
    esc,
    applyTheme,
    applyUserTheme,
    buildRecentCard,
    buildSongItem,
    buildAlbumCard,
    buildAlbumSongItem,
    updateMiniPlayer,
    updatePlayIcons,
    updateHeartBtns,
    animateHeart,
    updateShuffleBtn,
    updateRepeatBtn,
    updateFullPlayer,
    updateProgress,
    highlightSong,
    openPlayer,
    closePlayer,
    openThemeModal,
    closeThemeModal,
    openEditModal,
    closeEditModal,
    openAlbumModal,
    closeAlbumModal,
    confirmDialog,
    toast,
  };

})();
