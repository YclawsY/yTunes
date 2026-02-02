// yTunes - A nostalgic music player
// 🦞 Built by Molty

class Ytunes {
  constructor() {
    this.ipodTracks = [];
    this.localTracks = [];
    this.ytmTracks = []; // YouTube Music tracks
    this.tracks = []; // Current view tracks
    this.albums = [];
    this.artists = [];
    this.filteredTracks = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.sortColumn = 'title';
    this.sortAsc = true;
    this.recentlyPlayed = [];
    this.currentView = 'songs';
    this.currentSource = 'library'; // 'library', 'ipod', or 'ytm'
    this.ytmConnected = false;
    this.viewMode = 'list'; // Songs view defaults to list
    this.isLoading = false;
    this.ipodConnected = false;
    this.selectedTracks = new Set();

    // Playlists
    this.playlists = [];
    this.currentPlaylist = null;
    
    this.audio = document.getElementById('audio');
    this.initElements();
    this.initEvents();
    this.checkConnection();
  }

  initElements() {
    this.playBtn = document.getElementById('playBtn');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.progress = document.getElementById('progress');
    this.volume = document.getElementById('volume');
    this.currentTimeEl = document.getElementById('currentTime');
    this.durationEl = document.getElementById('duration');
    this.nowTitle = document.getElementById('nowTitle');
    this.nowArtist = document.getElementById('nowArtist');
    this.albumArt = document.getElementById('albumArt');
    this.gridView = document.getElementById('gridView');
    this.listView = document.getElementById('listView');
    this.trackList = document.getElementById('trackList');
    this.searchInput = document.getElementById('search');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.ejectBtn = document.getElementById('ejectBtn');
    this.setLibraryBtn = document.getElementById('setLibraryBtn');
    this.syncToIpodBtn = document.getElementById('syncToIpodBtn');
    this.syncToLibraryBtn = document.getElementById('syncToLibraryBtn');
    this.setYtmCookiesBtn = document.getElementById('setYtmCookiesBtn');
    this.ytmSource = document.getElementById('ytmSource');
    this.ytmCount = document.getElementById('ytmCount');
    this.ytmStatus = document.getElementById('ytmStatus');
    this.selectAllCheckbox = document.getElementById('selectAll');
    this.trackCountEl = document.getElementById('trackCount');
    this.totalTimeEl = document.getElementById('totalTime');
    this.deviceBtn = document.getElementById('deviceBtn');
    this.deviceMenu = document.getElementById('deviceMenu');
    this.deviceName = document.getElementById('deviceName');
    this.viewGridBtn = document.getElementById('viewGrid');
    this.viewListBtn = document.getElementById('viewList');
    this.cardSizeSlider = document.getElementById('cardSize');
    
    // Songs view starts with list mode, disable grid button and slider
    this.viewGridBtn.disabled = true;
    this.viewGridBtn.style.opacity = '0.3';
    this.viewGridBtn.classList.remove('active');
    this.viewListBtn.classList.add('active');
    this.cardSizeSlider.disabled = true;
    this.localCountEl = document.getElementById('localCount');
    this.ipodCountEl = document.getElementById('ipodCount');
    this.ipodLabelEl = document.getElementById('ipodLabel');
    this.progressBar = document.getElementById('progressBar');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    this.progressCount = document.getElementById('progressCount');
    this.progressIcon = document.getElementById('progressIcon');
    this.pauseSyncBtn = document.getElementById('pauseSyncBtn');
    this.stopSyncBtn = document.getElementById('stopSyncBtn');
    
    // Sync state
    this.syncPaused = false;
    this.syncCancelled = false;
    
    // Playlists list
    this.playlistsList = document.getElementById('playlistsList');
    this.newPlaylistBtn = document.getElementById('newPlaylistBtn');
    
    // Album art
    this.albumArtNotice = document.getElementById('albumArtNotice');
    this.fetchArtBtn = document.getElementById('fetchArtBtn');
    this.missingArtCount = document.getElementById('missingArtCount');
    this.artTooltip = document.getElementById('artTooltip');
    this.artTooltipText = document.getElementById('artTooltipText');
    this.fetchArtConfirm = document.getElementById('fetchArtConfirm');
    this.fetchArtDismiss = document.getElementById('fetchArtDismiss');
    this.artDismissedUntil = 0;
    
    // Genre art
    this.genreArtNotice = document.getElementById('genreArtNotice');
    this.genGenreArtBtn = document.getElementById('genGenreArtBtn');
    this.missingGenreCount = document.getElementById('missingGenreCount');
    this.genreArtTooltip = document.getElementById('genreArtTooltip');
    this.genreArtTooltipText = document.getElementById('genreArtTooltipText');
    this.genreApiKeyInput = document.getElementById('genreApiKeyInput');
    this.openrouterKeyInput = document.getElementById('openrouterKeyInput');
    this.genGenreArtDismiss = document.getElementById('genGenreArtDismiss');
    this.genreArtDismissedUntil = 0;
    this.hasOpenRouterKey = false;
  }

  showSyncProgress(icon, text, current = 0, total = 0) {
    this.progressBar.classList.remove('hidden', 'paused');
    this.progressIcon.textContent = icon;
    this.progressFill.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
    this.progressText.textContent = text;
    this.progressCount.textContent = `${current} of ${total}`;
    this.pauseSyncBtn.textContent = '❚❚';
    this.syncPaused = false;
    this.syncCancelled = false;
    // Update status bar
    this.setSyncStatusText(`Syncing: ${current} of ${total}`);
  }

  updateSyncProgress(text, current, total) {
    this.progressFill.style.width = `${(current / total) * 100}%`;
    this.progressText.textContent = text;
    this.progressCount.textContent = `${current} of ${total}`;
    // Update status bar
    this.setSyncStatusText(`Syncing: ${current} of ${total}`);
  }

  hideSyncProgress() {
    this.progressBar.classList.add('hidden');
    this.syncPaused = false;
    this.syncCancelled = false;
    // Reset status bar
    this.updateTrackCount();
  }
  
  setSyncStatusText(text) {
    this.trackCountEl.textContent = text;
  }

  toggleSyncPause() {
    this.syncPaused = !this.syncPaused;
    this.progressBar.classList.toggle('paused', this.syncPaused);
    this.pauseSyncBtn.textContent = this.syncPaused ? '▶' : '❚❚';
    this.progressText.textContent = this.syncPaused ? 'Paused' : 'Resuming...';
  }

  cancelSync() {
    this.syncCancelled = true;
    this.progressText.textContent = 'Stopping...';
  }

  async waitWhilePaused() {
    while (this.syncPaused && !this.syncCancelled) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  initEvents() {
    // Playback controls
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
    
    // Audio events
    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('loadedmetadata', () => this.updateDuration());
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('play', () => this.setPlayingState(true));
    this.audio.addEventListener('pause', () => this.setPlayingState(false));
    
    // Progress & Volume
    this.progress.addEventListener('input', (e) => this.seek(e.target.value));
    this.volume.addEventListener('input', (e) => this.setVolume(e.target.value));
    this.audio.volume = this.volume.value / 100;
    
    // Search
    this.searchInput.addEventListener('input', (e) => this.search(e.target.value));
    
    // Device dropdown
    this.deviceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deviceMenu.classList.toggle('hidden');
    });
    
    document.addEventListener('click', () => {
      this.deviceMenu.classList.add('hidden');
    });
    
    this.deviceMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    
    // Refresh
    this.refreshBtn.addEventListener('click', () => {
      this.deviceMenu.classList.add('hidden');
      this.refresh();
    });
    
    
    // YouTube Music
    this.setYtmCookiesBtn.addEventListener('click', () => {
      this.deviceMenu.classList.add('hidden');
      this.setYtmCookies();
    });
    
    this.ytmSource.addEventListener('click', () => {
      this.switchSource('ytm');
      this.deviceMenu.classList.add('hidden');
    });
    
    // Eject
    this.ejectBtn.addEventListener('click', () => {
      this.deviceMenu.classList.add('hidden');
      this.eject();
    });
    
    // Sync
    this.syncToIpodBtn.addEventListener('click', () => this.syncToIPod());
    this.syncToLibraryBtn.addEventListener('click', () => this.syncToLibrary());
    this.pauseSyncBtn.addEventListener('click', () => this.toggleSyncPause());
    this.stopSyncBtn.addEventListener('click', () => this.cancelSync());
    
    // Album art
    this.fetchArtConfirm.addEventListener('click', () => this.fetchMissingAlbumArt());
    this.fetchArtDismiss.addEventListener('click', () => this.dismissAlbumArtNotice());
    
    // Genre art
    this.genGenreArtMissing = document.getElementById('genGenreArtMissing');
    this.genGenreArtAll = document.getElementById('genGenreArtAll');
    this.genGenreArtMissing.addEventListener('click', () => this.generateGenreArt(false));
    this.genGenreArtAll.addEventListener('click', () => this.generateGenreArt(true));
    this.genGenreArtDismiss.addEventListener('click', () => this.dismissGenreArtNotice());
    
    // Select all
    this.selectAllCheckbox.addEventListener('change', (e) => {
      this.toggleSelectAll(e.target.checked);
    });
    
    // Source selection in device dropdown
    document.querySelectorAll('.device-menu-source').forEach(source => {
      source.addEventListener('click', () => {
        document.querySelectorAll('.device-menu-source').forEach(s => s.classList.remove('active'));
        source.classList.add('active');
        this.currentSource = source.dataset.source;
        this.selectedTracks.clear();
        this.updateSyncButtons();
        this.switchSource();
        this.updateDeviceButton();
        this.deviceMenu.classList.add('hidden');
      });
    });
    
    // View toggle
    this.viewGridBtn.addEventListener('click', () => this.setViewMode('grid'));
    this.viewListBtn.addEventListener('click', () => this.setViewMode('list'));
    
    // Card size slider
    this.cardSizeSlider.addEventListener('input', () => {
      const size = this.cardSizeSlider.value;
      this.gridView.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
    });
    
    // Unified view switching - syncs sidebar and content tabs
    this.switchToView = (viewName) => {
      this.currentView = viewName;
      
      // Update sidebar active state
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      const sidebarItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
      if (sidebarItem) sidebarItem.classList.add('active');
      
      // Update content tabs active state (only for albums, artists, genres, songs)
      document.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
      const contentTab = document.querySelector(`.content-tab[data-view="${viewName}"]`);
      if (contentTab) contentTab.classList.add('active');
      
      // Songs view: force list mode, disable grid button and slider
      // All other views: force grid mode, disable list button, enable slider
      if (viewName === 'songs') {
        this.viewGridBtn.disabled = true;
        this.viewGridBtn.style.opacity = '0.3';
        this.viewListBtn.disabled = false;
        this.viewListBtn.style.opacity = '1';
        this.cardSizeSlider.disabled = true;
        this.setViewMode('list');
      } else {
        this.viewListBtn.disabled = true;
        this.viewListBtn.style.opacity = '0.3';
        this.viewGridBtn.disabled = false;
        this.viewGridBtn.style.opacity = '1';
        this.cardSizeSlider.disabled = false;
        this.setViewMode('grid');
      }
      
      this.renderView();
    };
    
    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        this.switchToView(item.dataset.view);
      });
    });
    
    // Content tabs navigation (Albums, Artists, Genres, Songs)
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchToView(tab.dataset.view);
      });
    });
    
    // Column sorting
    document.querySelectorAll('.sortable').forEach(col => {
      col.addEventListener('click', () => this.sortBy(col.dataset.sort));
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      
      // Ctrl+A to select all
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault();
        // Select all tracks in current view
        const tracks = this.currentView === 'recently-played' ? this.recentlyPlayed : this.filteredTracks;
        tracks.forEach(t => this.selectedTracks.add(t.id));
        if (this.selectAllCheckbox) this.selectAllCheckbox.checked = true;
        this.updateSyncButtons();
        this.renderView();
        console.log(`Selected ${this.selectedTracks.size} tracks`);
        return;
      }
      
      // Escape to deselect all
      if (e.code === 'Escape') {
        this.selectedTracks.clear();
        if (this.selectAllCheckbox) this.selectAllCheckbox.checked = false;
        this.updateSyncButtons();
        this.renderView();
        console.log('Cleared selection');
        return;
      }
      
      switch(e.code) {
        case 'Space': e.preventDefault(); this.togglePlay(); break;
        case 'ArrowLeft': this.audio.currentTime -= 10; break;
        case 'ArrowRight': this.audio.currentTime += 10; break;
      }
    });
    
    // Playlists
    this.newPlaylistBtn.addEventListener('click', () => this.createPlaylist());
  }

  setViewMode(mode) {
    // Songs view always forces list mode, all others force grid
    if (this.currentView === 'songs') {
      mode = 'list';
    } else {
      mode = 'grid';
    }
    
    this.viewMode = mode;
    this.viewGridBtn.classList.toggle('active', mode === 'grid');
    this.viewListBtn.classList.toggle('active', mode === 'list');
    this.gridView.classList.toggle('hidden', mode === 'list');
    this.listView.classList.toggle('hidden', mode === 'grid');
    this.renderView();
  }

  async checkConnection() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      this.ipodConnected = data.connected;
      this.updateConnectionStatus(data);
      this.updateSourceCounts(data);

      // Check YouTube Music status
      await this.checkYtmStatus();

      // Load playlists for current source
      await this.loadPlaylists();

      // Load based on current source
      if (this.currentSource === 'library' && data.localTrackCount >= 0) {
        await this.loadLocalTracks();
      } else if (this.currentSource === 'ipod' && data.connected) {
        await this.loadIPodTracks();
      } else if (this.currentSource === 'ytm' && this.ytmConnected) {
        await this.loadYtmTracks();
      } else if (data.connected) {
        // Default to iPod if library not set
        document.querySelector('.device-menu-source[data-source="ipod"]').click();
      }
    } catch (e) {
      // Connection check failed - will be updated by refresh
    }
  }
  
  async checkYtmStatus() {
    try {
      const res = await fetch('/api/ytm/status');
      const data = await res.json();
      this.ytmConnected = data.connected;
      this.ytmCount.textContent = data.trackCount;
      this.ytmStatus.classList.toggle('connected', data.connected);
      this.ytmStatus.classList.toggle('disconnected', !data.connected);
      
      if (data.fetching) {
        this.ytmCount.textContent = `${data.fetchProgress}/${data.fetchTotal}`;
      }
      if (data.downloading) {
        this.ytmCount.textContent = `↓${data.downloadCompleted}/${data.downloadTotal}`;
      }
    } catch (e) {
      console.error('Failed to check YTM status:', e);
    }
  }
  
  async setYtmCookies() {
    const cookiesPath = prompt(
      'Enter path to YouTube Music cookies file:\n\n' +
      'To export cookies from Firefox:\n' +
      '1. Install "cookies.txt" extension\n' +
      '2. Go to music.youtube.com and sign in\n' +
      '3. Click the extension and export cookies\n' +
      '4. Save the file and enter the path here'
    );
    
    if (!cookiesPath) return;
    
    try {
      const res = await fetch('/api/ytm/set-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookiesPath })
      });
      const data = await res.json();
      
      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }
      
      this.ytmConnected = true;
      this.ytmStatus.classList.add('connected');
      this.ytmStatus.classList.remove('disconnected');
      
      // Offer to fetch library
      if (confirm('YouTube Music connected! Fetch your library now?')) {
        this.fetchYtmLibrary();
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }
  
  async fetchYtmLibrary() {
    try {
      const res = await fetch('/api/ytm/fetch', { method: 'POST' });
      const data = await res.json();
      
      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }
      
      if (data.started) {
        // Poll for progress
        const pollInterval = setInterval(async () => {
          await this.checkYtmStatus();
          const status = await fetch('/api/ytm/status').then(r => r.json());
          if (!status.fetching) {
            clearInterval(pollInterval);
            this.checkYtmStatus();
            if (this.currentSource === 'ytm') {
              this.loadYtmTracks();
            }
          }
        }, 1000);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }
  
  async loadYtmTracks() {
    try {
      const res = await fetch('/api/ytm/tracks');
      const data = await res.json();
      this.ytmTracks = data.tracks.map(t => ({
        id: t.id,
        videoId: t.video_id,
        title: t.title,
        artist: t.artist,
        album: t.album || 'YouTube Music',
        duration: t.duration,
        thumbnail: t.thumbnail,
        source: 'ytm'
      }));
      this.tracks = this.ytmTracks;
      this.renderView();
    } catch (e) {
      console.error('Failed to load YTM tracks:', e);
    }
  }
  
  async downloadYtmTracks(trackIds) {
    if (!trackIds.length) {
      alert('No tracks selected');
      return;
    }
    
    if (!confirm(`Download ${trackIds.length} track(s) to your library?`)) {
      return;
    }
    
    try {
      const res = await fetch('/api/ytm/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds })
      });
      const data = await res.json();
      
      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }
      
      if (data.started) {
        // Poll for progress
        const pollInterval = setInterval(async () => {
          await this.checkYtmStatus();
          const status = await fetch('/api/ytm/status').then(r => r.json());
          if (!status.downloading) {
            clearInterval(pollInterval);
            this.checkYtmStatus();
            alert(`Download complete: ${status.downloadCompleted} tracks`);
            // Refresh library if needed
            if (this.currentSource === 'library') {
              this.loadLocalTracks();
            }
          }
        }, 2000);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }
  
  async loadPlaylists() {
    try {
      const res = await fetch(`/api/playlists?source=${this.currentSource}`);
      const data = await res.json();
      this.playlists = data.playlists || [];
      this.renderPlaylistsSidebar();
    } catch (e) {
      console.error('Failed to load playlists:', e);
    }
  }

  renderPlaylistsSidebar() {
    this.playlistsList.innerHTML = this.playlists.map(p => `
      <li class="nav-item playlist-item" data-playlist-id="${p.id}">
        <span>${p.name}</span>
        <span class="playlist-count">${p.trackCount}</span>
      </li>
    `).join('');

    // Add click handlers
    document.querySelectorAll('.playlist-item').forEach(item => {
      item.addEventListener('click', () => this.viewPlaylist(item.dataset.playlistId));
    });
  }

  async createPlaylist() {
    const name = prompt('Enter playlist name:');
    if (!name) return;

    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, source: this.currentSource })
      });

      if (res.ok) {
        await this.loadPlaylists();
      }
    } catch (e) {
      alert('Failed to create playlist');
    }
  }

  async deletePlaylist(id) {
    if (!confirm('Delete this playlist?')) return;

    await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
    await this.loadPlaylists();
  }

  async renamePlaylist(id) {
    const name = prompt('Enter new name:');
    if (!name) return;

    await fetch(`/api/playlists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    await this.loadPlaylists();
  }

  async viewPlaylist(playlistId) {
    this.currentPlaylist = playlistId;
    const res = await fetch(`/api/playlists/${playlistId}/tracks`);
    const data = await res.json();
    this.tracks = data.tracks || [];
    this.currentView = 'playlist';
    this.renderView();
  }

  updateConnectionStatus(data) {
    const connectionDot = document.getElementById('connectionStatus');
    const ipodSource = document.getElementById('ipodSource');
    
    if (data.connected) {
      connectionDot.className = 'connection-dot connected';
      this.ejectBtn.disabled = false;
      ipodSource.style.display = '';
      
      const volumeName = data.volumeName || data.path?.split('/').pop() || 'iPod';
      const ipodName = data.ipodName;
      
      if (ipodName) {
        this.ipodLabelEl.textContent = `${ipodName}`;
      } else {
        this.ipodLabelEl.textContent = volumeName || 'iPod';
      }
      
      // Hide unmounted devices section if connected
      this.hideUnmountedDevices();
    } else {
      connectionDot.className = 'connection-dot disconnected';
      this.ipodLabelEl.textContent = 'iPod';
      this.ejectBtn.disabled = true;
      ipodSource.style.display = 'none';
      
      // Show unmounted devices if any
      if (data.unmountedDevices && data.unmountedDevices.length > 0) {
        this.showUnmountedDevices(data.unmountedDevices);
      } else {
        this.hideUnmountedDevices();
      }
    }
    
    this.updateDeviceButton();
  }
  
  showUnmountedDevices(devices) {
    let container = document.getElementById('unmountedDevices');
    if (!container) {
      // Create the unmounted devices section
      const deviceMenu = document.getElementById('deviceMenu');
      const sourcesSection = deviceMenu.querySelector('.device-menu-section');
      
      container = document.createElement('div');
      container.id = 'unmountedDevices';
      container.className = 'device-menu-section unmounted-section';
      container.innerHTML = '<div class="device-menu-header">UNMOUNTED DEVICES</div>';
      
      // Insert after sources section
      sourcesSection.parentNode.insertBefore(container, sourcesSection.nextSibling);
    }
    
    // Clear existing device buttons (keep header)
    const header = container.querySelector('.device-menu-header');
    container.innerHTML = '';
    container.appendChild(header);
    
    // Add device buttons
    for (const device of devices) {
      const btn = document.createElement('button');
      btn.className = 'device-menu-item unmounted-device';
      btn.innerHTML = `
        <span class="menu-icon">💾</span>
        <span class="device-name">${device.name}</span>
        <span class="device-size">${device.size}</span>
        <span class="mount-hint">Click to mount</span>
      `;
      btn.addEventListener('click', () => this.mountDevice(device.device));
      container.appendChild(btn);
    }
    
    container.style.display = '';
  }
  
  hideUnmountedDevices() {
    const container = document.getElementById('unmountedDevices');
    if (container) {
      container.style.display = 'none';
    }
  }
  
  async mountDevice(devicePath) {
    console.log(`Attempting to mount ${devicePath}...`);

    // Find the button and add loading state
    const deviceButtons = document.querySelectorAll('.unmounted-device');
    let targetButton = null;
    deviceButtons.forEach(btn => {
      if (btn.textContent.includes(devicePath)) {
        targetButton = btn;
      }
    });

    if (targetButton) {
      targetButton.disabled = true;
      targetButton.style.opacity = '0.6';
      const originalHtml = targetButton.innerHTML;
      targetButton.innerHTML = '<span class="menu-icon">⏳</span><span class="device-name">Mounting...</span>';

      try {
        const res = await fetch('/api/mount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: devicePath })
        });
        const data = await res.json();

        if (data.success) {
          console.log(`Mounted at ${data.mountPoint}`);
          targetButton.innerHTML = '<span class="menu-icon">✓</span><span class="device-name">Mounted!</span>';
          // Refresh to pick up the newly mounted device
          setTimeout(() => this.refresh(), 1000);
        } else {
          targetButton.innerHTML = originalHtml;
          targetButton.disabled = false;
          targetButton.style.opacity = '1';
          alert(`Failed to mount device: ${data.error}\n\nThe device may already be mounted. Try clicking "Refresh Devices" to detect it.`);
        }
      } catch (e) {
        targetButton.innerHTML = originalHtml;
        targetButton.disabled = false;
        targetButton.style.opacity = '1';
        alert(`Failed to mount device: ${e.message}`);
      }
    } else {
      // Fallback without button reference
      try {
        const res = await fetch('/api/mount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: devicePath })
        });
        const data = await res.json();

        if (data.success) {
          console.log(`Mounted at ${data.mountPoint}`);
          setTimeout(() => this.refresh(), 1000);
        } else {
          alert(`Failed to mount device: ${data.error}\n\nThe device may already be mounted. Try clicking "Refresh Devices" to detect it.`);
        }
      } catch (e) {
        alert(`Failed to mount device: ${e.message}`);
      }
    }
  }
  
  updateDeviceButton() {
    const deviceNameEl = document.getElementById('deviceName');
    const deviceCountEl = document.getElementById('deviceCount');
    
    if (this.currentSource === 'library') {
      deviceNameEl.textContent = 'Localmolt';
      deviceCountEl.textContent = this.localCountEl.textContent;
    } else {
      deviceNameEl.textContent = this.ipodLabelEl.textContent || 'iPod';
      deviceCountEl.textContent = this.ipodCountEl.textContent;
    }
  }

  updateSourceCounts(data) {
    this.localCountEl.textContent = data.localTrackCount || 0;
    this.ipodCountEl.textContent = data.ipodTrackCount || 0;
    
    // Update iPod source label with name
    if (data.ipodName) {
      this.ipodLabelEl.textContent = data.ipodName;
    } else if (data.volumeName) {
      this.ipodLabelEl.textContent = data.volumeName;
    } else {
      this.ipodLabelEl.textContent = 'iPod';
    }
    
    this.updateDeviceButton();
    
    // Check for missing album art
    this.checkMissingAlbumArt();
    
    // Check for missing genre art
    this.checkMissingGenreArt();
  }
  
  async checkMissingAlbumArt() {
    // Skip if dismissed recently (1 hour)
    if (Date.now() < this.artDismissedUntil) {
      return;
    }
    
    try {
      const res = await fetch('/api/art/status');
      const data = await res.json();
      
      // If fetching is in progress, show progress
      if (data.fetching) {
        this.showArtFetchProgress(data);
        return;
      }
      
      if (data.missingCount > 0) {
        this.missingArtCount.textContent = data.missingCount;
        this.artTooltipText.textContent = `${data.missingCount} albums missing artwork. Fetch now?`;
        this.albumArtNotice.classList.remove('hidden');
        this.fetchArtBtn.classList.remove('fetching');
        this.fetchArtConfirm.disabled = false;
        this.fetchArtConfirm.textContent = 'Fetch';
        this.fetchArtDismiss.style.display = '';
      } else {
        this.albumArtNotice.classList.add('hidden');
      }
    } catch (e) {
      console.error('Failed to check album art status:', e);
    }
  }
  
  showArtFetchProgress(data) {
    this.albumArtNotice.classList.remove('hidden');
    this.fetchArtBtn.classList.add('fetching');
    this.missingArtCount.textContent = `${data.fetchProgress}/${data.fetchTotal}`;
    this.artTooltipText.textContent = `Fetching album art: ${data.fetchProgress} of ${data.fetchTotal} (${data.fetchFound} found)`;
    this.fetchArtConfirm.disabled = true;
    this.fetchArtConfirm.textContent = 'Fetching...';
    this.fetchArtDismiss.style.display = 'none';
  }
  
  async fetchMissingAlbumArt() {
    this.fetchArtConfirm.disabled = true;
    this.fetchArtConfirm.textContent = 'Starting...';
    this.fetchArtDismiss.style.display = 'none';
    
    try {
      const res = await fetch('/api/art/fetch', { method: 'POST' });
      const data = await res.json();
      
      if (data.started || data.alreadyRunning) {
        // Start polling for progress
        this.startArtFetchPolling();
      }
    } catch (e) {
      console.error('Failed to fetch album art:', e);
      this.artTooltipText.textContent = 'Failed to start fetch';
      this.fetchArtConfirm.disabled = false;
      this.fetchArtConfirm.textContent = 'Fetch';
      this.fetchArtDismiss.style.display = '';
    }
  }
  
  startArtFetchPolling() {
    // Clear any existing poll
    if (this.artPollInterval) {
      clearInterval(this.artPollInterval);
    }
    
    this.artPollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/art/status');
        const data = await res.json();
        
        if (data.fetching) {
          this.showArtFetchProgress(data);
        } else {
          // Fetching complete
          clearInterval(this.artPollInterval);
          this.artPollInterval = null;
          
          this.fetchArtBtn.classList.remove('fetching');
          this.artTooltipText.textContent = `Done! Found art for ${data.fetchFound || 0} albums.`;
          this.fetchArtConfirm.textContent = 'Done';
          
          // Refresh the view to show new album art
          setTimeout(() => {
            this.renderView();
            this.checkMissingAlbumArt();
          }, 2000);
        }
      } catch (e) {
        console.error('Art poll failed:', e);
      }
    }, 1000);
  }
  
  dismissAlbumArtNotice() {
    // Dismiss for 1 hour
    this.artDismissedUntil = Date.now() + (60 * 60 * 1000);
    this.albumArtNotice.classList.add('hidden');
  }
  
  // === Genre Art ===
  
  async checkMissingGenreArt() {
    // Skip if dismissed recently (1 hour)
    if (Date.now() < this.genreArtDismissedUntil) {
      return;
    }
    
    try {
      const res = await fetch('/api/genre-art/status');
      const data = await res.json();
      
      this.hasOpenRouterKey = data.hasApiKey;
      
      // If generating is in progress, show progress
      if (data.generating) {
        this.showGenreArtProgress(data);
        return;
      }
      
      // Always show the genre art button
      this.genGenreArtBtn.classList.remove('fetching');
      this.genGenreArtMissing.disabled = false;
      this.genGenreArtAll.disabled = false;
      this.genGenreArtMissing.textContent = 'Generate Missing';
      this.genGenreArtDismiss.style.display = '';
      
      if (data.missingCount > 0) {
        this.missingGenreCount.textContent = data.missingCount;
        this.missingGenreCount.classList.remove('hidden');
        this.genreArtTooltipText.textContent = `${data.missingCount} genres need covers. Generate or regenerate all?`;
      } else {
        this.missingGenreCount.classList.add('hidden');
        this.genreArtTooltipText.textContent = `All genre covers generated! Regenerate all?`;
        this.genGenreArtMissing.disabled = true;
      }
      
      // Show API key input if not set
      if (!data.hasApiKey) {
        this.genreApiKeyInput.style.display = 'block';
      } else {
        this.genreApiKeyInput.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to check genre art status:', e);
    }
  }
  
  showGenreArtProgress(data) {
    this.genGenreArtBtn.classList.add('fetching');
    this.missingGenreCount.textContent = `${data.genProgress}/${data.genTotal}`;
    this.missingGenreCount.classList.remove('hidden');
    this.genreArtTooltipText.textContent = `Generating genre art: ${data.genProgress} of ${data.genTotal} (${data.genGenerated} created)`;
    this.genGenreArtMissing.disabled = true;
    this.genGenreArtAll.disabled = true;
    this.genGenreArtMissing.textContent = 'Generating...';
    this.genGenreArtDismiss.style.display = 'none';
    this.genreApiKeyInput.style.display = 'none';
  }
  
  async generateGenreArt(regenerateAll = false) {
    // If API key is provided, save it first
    const keyInput = this.openrouterKeyInput.value.trim();
    if (keyInput) {
      try {
        await fetch('/api/genre-art/set-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: keyInput })
        });
        this.hasOpenRouterKey = true;
        this.openrouterKeyInput.value = '';
      } catch (e) {
        console.error('Failed to save API key:', e);
        alert('Failed to save API key');
        return;
      }
    }
    
    // Check if we have a key now
    if (!this.hasOpenRouterKey && !keyInput) {
      alert('Please enter your OpenRouter API key');
      this.openrouterKeyInput.focus();
      return;
    }
    
    // Confirm regenerate all
    if (regenerateAll && !confirm('This will regenerate ALL genre artwork, replacing existing images. Continue?')) {
      return;
    }
    
    this.genGenreArtMissing.disabled = true;
    this.genGenreArtAll.disabled = true;
    this.genGenreArtMissing.textContent = 'Starting...';
    this.genGenreArtDismiss.style.display = 'none';
    this.genreApiKeyInput.style.display = 'none';
    
    try {
      const endpoint = regenerateAll ? '/api/genre-art/regenerate-all' : '/api/genre-art/generate';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      
      if (data.error) {
        alert(`Error: ${data.error}`);
        this.genGenreArtMissing.disabled = false;
        this.genGenreArtAll.disabled = false;
        this.genGenreArtMissing.textContent = 'Generate Missing';
        return;
      }
      
      if (data.started || data.alreadyRunning) {
        this.startGenreArtPolling();
      }
    } catch (e) {
      console.error('Failed to generate genre art:', e);
      this.genreArtTooltipText.textContent = 'Failed to start generation';
      this.genGenreArtMissing.disabled = false;
      this.genGenreArtAll.disabled = false;
      this.genGenreArtMissing.textContent = 'Generate Missing';
    }
  }
  
  startGenreArtPolling() {
    if (this.genrePollInterval) {
      clearInterval(this.genrePollInterval);
    }
    
    this.genrePollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/genre-art/status');
        const data = await res.json();
        
        if (data.generating) {
          this.showGenreArtProgress(data);
        } else {
          // Generation complete
          clearInterval(this.genrePollInterval);
          this.genrePollInterval = null;
          
          this.genGenreArtBtn.classList.remove('fetching');
          this.genreArtTooltipText.textContent = `Done! Generated ${data.genGenerated || 0} genre covers.`;
          this.genGenreArtMissing.textContent = 'Done';
          
          // Refresh the view
          setTimeout(() => {
            this.renderView();
            this.checkMissingGenreArt();
          }, 2000);
        }
      } catch (e) {
        console.error('Genre poll failed:', e);
      }
    }, 2000);
  }
  
  dismissGenreArtNotice() {
    this.genreArtDismissedUntil = Date.now() + (60 * 60 * 1000);
    this.genreArtNotice.classList.add('hidden');
  }

  async refresh() {
    this.refreshBtn.disabled = true;
    const originalText = this.refreshBtn.innerHTML;
    this.refreshBtn.innerHTML = 'Scanning...';

    try {
      const res = await fetch('/api/refresh');
      const data = await res.json();
      this.ipodConnected = data.connected;
      this.updateConnectionStatus(data);
      this.updateSourceCounts(data);

      await this.switchSource();
    } catch (e) {
      console.error('Refresh failed:', e);
    }

    this.refreshBtn.disabled = false;
    this.refreshBtn.innerHTML = originalText;
  }

  async switchSource(source) {
    if (source) this.currentSource = source;

    // Update active state in dropdown
    document.querySelectorAll('.device-menu-source').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === this.currentSource);
    });

    // Load playlists for this source
    await this.loadPlaylists();

    if (this.currentSource === 'library') {
      await this.loadLocalTracks();
    } else if (this.currentSource === 'ytm') {
      if (!this.ytmConnected) {
        this.setYtmCookies();
        return;
      }
      await this.loadYtmTracks();
    } else {
      await this.loadIPodTracks();
    }

    this.updateSyncButtons();
  }

  async loadIPodTracks() {
    this.isLoading = true;
    this.gridView.innerHTML = '<div class="loading">Loading iPod...</div>';
    
    try {
      const res = await fetch('/api/tracks');
      const data = await res.json();
      
      this.ipodTracks = data.tracks.map(t => ({
        ...t,
        title: t.title || 'Loading...',
        artist: t.artist || '',
        album: t.album || '',
        durationStr: this.formatTime(t.duration || 0)
      }));
      
      this.tracks = this.ipodTracks;
      this.processLibrary();
      this.filteredTracks = [...this.tracks];
      this.sortTracks();
      this.renderView();
      this.updateTrackCount();
      
      // Load metadata progressively
      await this.loadMetadataProgressively('ipod');
      
    } catch (e) {
      console.error('Failed to load iPod tracks:', e);
      this.gridView.innerHTML = '<div class="empty-state"><div class="empty-icon">📱</div><div class="empty-text">Connect an iPod to view its library</div></div>';
    }
    
    this.isLoading = false;
  }

  async loadLocalTracks() {
    this.isLoading = true;
    this.gridView.innerHTML = '<div class="loading">Loading library...</div>';

    try {
      const res = await fetch('/api/library/tracks');
      const data = await res.json();

      this.localTracks = data.tracks.map(t => ({
        ...t,
        title: t.title || t.path?.split('/').pop() || 'Unknown',
        artist: t.artist || 'Unknown Artist',
        album: t.album || 'Unknown Album',
        durationStr: this.formatTime(t.duration || 0)
      }));

      this.tracks = this.localTracks;
      this.processLibrary();
      this.filteredTracks = [...this.tracks];
      this.sortTracks();
      this.renderView();
      this.updateTrackCount();

      // Metadata already loaded from database - no progressive loading needed for local

    } catch (e) {
      console.error('Failed to load local tracks:', e);
      this.gridView.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load library</div></div>';
    }

    this.isLoading = false;
  }

  async loadMetadataProgressively(source) {
    const batchSize = 50;
    const trackIds = this.tracks.map(t => t.id);
    
    for (let i = 0; i < trackIds.length; i += batchSize) {
      const batch = trackIds.slice(i, i + batchSize);
      
      try {
        const res = await fetch(`/api/metadata?ids=${batch.join(',')}&source=${source}`);
        const metadata = await res.json();
        
        let updated = false;
        for (const [id, meta] of Object.entries(metadata)) {
          const track = this.tracks.find(t => t.id === id);
          if (track) {
            Object.assign(track, meta);
            track.durationStr = this.formatTime(meta.duration || 0);
            updated = true;
          }
        }
        
        if (updated && (i % 200 === 0 || i + batchSize >= trackIds.length)) {
          this.processLibrary();
          this.filteredTracks = [...this.tracks];
          this.sortTracks();
          this.renderView();
          this.updateTrackCount();
        }
      } catch (e) {
        console.error('Metadata batch failed:', e);
      }
    }
  }

  processLibrary() {
    const albumMap = new Map();
    this.tracks.forEach(t => {
      const key = `${t.album}|||${t.artist}`;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          name: t.album || 'Unknown Album',
          artist: t.artist || 'Unknown Artist',
          year: t.year,
          tracks: [],
          genre: t.genre
        });
      }
      albumMap.get(key).tracks.push(t);
    });
    this.albums = [...albumMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    
    const artistMap = new Map();
    this.tracks.forEach(t => {
      const artist = t.artist || 'Unknown Artist';
      if (!artistMap.has(artist)) {
        artistMap.set(artist, { name: artist, albums: new Set(), tracks: [] });
      }
      const data = artistMap.get(artist);
      if (t.album) data.albums.add(t.album);
      data.tracks.push(t);
    });
    this.artists = [...artistMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  renderView() {
    // Songs view always uses list mode
    if (this.currentView === 'songs') {
      this.gridView.classList.add('hidden');
      this.listView.classList.remove('hidden');
      this.viewGridBtn.classList.remove('active');
      this.viewListBtn.classList.add('active');
      this.renderListView();
      return;
    }
    
    if (this.viewMode === 'grid') {
      this.renderGridView();
    } else {
      this.renderListView();
    }
  }

  renderGridView() {
    switch(this.currentView) {
      case 'albums':
      case 'recently-added':
        this.renderAlbumGrid();
        break;
      case 'artists':
        this.renderArtistGrid();
        break;
      case 'genres':
        this.renderGenreGrid();
        break;
      case 'recently-played':
        this.renderRecentGrid();
        break;
    }
  }

  renderAlbumGrid() {
    if (this.albums.length === 0) {
      this.gridView.innerHTML = this.emptyState();
      return;
    }

    this.gridView.innerHTML = this.albums.map(album => {
      const artTrackId = album.tracks[0]?.id || '';
      const allSelected = album.tracks.every(t => this.selectedTracks.has(t.id));
      const someSelected = album.tracks.some(t => this.selectedTracks.has(t.id));
      return `
      <div class="album-card ${allSelected ? 'selected' : ''} ${someSelected && !allSelected ? 'partial' : ''}" data-album="${this.escapeHtml(album.name)}" data-artist="${this.escapeHtml(album.artist)}">
        <div class="album-art" data-art-id="${artTrackId}">
          <div class="play-overlay"><span>▶</span></div>
          <div class="select-overlay ${allSelected ? 'selected' : ''}" title="Click to select album">
            <span>${allSelected ? '✓' : '○'}</span>
          </div>
        </div>
        <div class="album-title" title="${this.escapeHtml(album.name)}">${this.escapeHtml(album.name)}</div>
        <div class="album-artist" title="${this.escapeHtml(album.artist)}">${this.escapeHtml(album.artist)}</div>
      </div>
    `}).join('');
    
    this.loadAlbumArt();

    this.gridView.querySelectorAll('.album-card').forEach(card => {
      const selectOverlay = card.querySelector('.select-overlay');
      
      // Click select overlay to toggle selection
      selectOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        const albumName = card.dataset.album;
        const artistName = card.dataset.artist;
        const album = this.albums.find(a => a.name === albumName && a.artist === artistName);
        if (album) {
          const allSelected = album.tracks.every(t => this.selectedTracks.has(t.id));
          album.tracks.forEach(t => {
            if (allSelected) {
              this.selectedTracks.delete(t.id);
            } else {
              this.selectedTracks.add(t.id);
            }
          });
          this.updateSyncButtons();
          this.renderAlbumGrid();
        }
      });
      
      // Double click to play
      card.addEventListener('dblclick', () => {
        const albumName = card.dataset.album;
        const artistName = card.dataset.artist;
        const album = this.albums.find(a => a.name === albumName && a.artist === artistName);
        if (album && album.tracks.length > 0) {
          this.filteredTracks = [...album.tracks];
          this.playTrack(0, this.filteredTracks);
        }
      });
    });
  }

  renderArtistGrid() {
    if (this.artists.length === 0) {
      this.gridView.innerHTML = this.emptyState();
      return;
    }

    // Find most frequent album for each artist to use as their image
    this.artists.forEach(artist => {
      const albumCounts = {};
      artist.tracks.forEach(t => {
        const album = t.album || 'Unknown';
        albumCounts[album] = (albumCounts[album] || 0) + 1;
      });
      // Find album with most tracks
      let maxCount = 0;
      let bestAlbum = null;
      for (const [album, count] of Object.entries(albumCounts)) {
        if (count > maxCount) {
          maxCount = count;
          bestAlbum = album;
        }
      }
      // Get a track from that album for art
      artist.artTrack = artist.tracks.find(t => t.album === bestAlbum);
    });

    this.gridView.innerHTML = this.artists.map(artist => {
      const artTrackId = artist.artTrack?.id || '';
      return `
      <div class="album-card artist-card" data-artist="${this.escapeHtml(artist.name)}">
        <div class="album-art" data-art-id="${artTrackId}">
          <div class="play-overlay"><span>▶</span></div>
        </div>
        <div class="album-title">${this.escapeHtml(artist.name)}</div>
        <div class="album-artist">${artist.albums.size} albums, ${artist.tracks.length} songs</div>
      </div>
    `}).join('');
    
    this.loadAlbumArt();

    this.gridView.querySelectorAll('.artist-card').forEach(card => {
      card.addEventListener('click', () => {
        const artistName = card.dataset.artist;
        this.searchInput.value = artistName;
        this.search(artistName);
        // Switch to songs view via sidebar
        this.currentView = 'songs';
        document.querySelectorAll('.nav-item').forEach(i => {
          i.classList.toggle('active', i.dataset.view === 'songs');
        });
        this.renderView();
      });
    });
  }

  renderGenreGrid() {
    const genreMap = new Map();
    this.tracks.forEach(t => {
      const genre = t.genre || 'Unknown';
      if (!genreMap.has(genre)) {
        genreMap.set(genre, { name: genre, count: 0 });
      }
      genreMap.get(genre).count++;
    });
    const genres = [...genreMap.values()].sort((a, b) => a.name.localeCompare(b.name));

    // Create safe filename for genre art lookup
    const safeGenreName = (name) => name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);

    this.gridView.innerHTML = genres.map(genre => {
      const safeGenre = safeGenreName(genre.name);
      const artUrl = `/genre-art/${safeGenre}.png`;
      const fallbackStyle = `background: linear-gradient(135deg, #${this.hashColor(genre.name)} 0%, #${this.hashColor(genre.name + 'x')} 100%);`;
      
      return `
        <div class="album-card" data-genre="${this.escapeHtml(genre.name)}">
          <div class="album-art genre-art" data-genre-art="${artUrl}" style="${fallbackStyle}">
          </div>
          <div class="album-title">${this.escapeHtml(genre.name)}</div>
          <div class="album-artist">${genre.count} songs</div>
        </div>
      `;
    }).join('');

    // Try to load genre art images
    this.gridView.querySelectorAll('.genre-art').forEach(artEl => {
      const artUrl = artEl.dataset.genreArt;
      const img = new Image();
      img.onload = () => {
        artEl.style.backgroundImage = `url(${artUrl})`;
        artEl.style.backgroundSize = 'cover';
        artEl.style.backgroundPosition = 'center';
        artEl.classList.add('has-art');
      };
      img.src = artUrl;
    });

    this.gridView.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('click', () => {
        const genre = card.dataset.genre;
        this.filteredTracks = this.tracks.filter(t => (t.genre || 'Unknown') === genre);
        this.setViewMode('list');
        this.renderListTracks();
      });
    });
  }

  renderRecentGrid() {
    if (this.recentlyPlayed.length === 0) {
      this.gridView.innerHTML = '<div class="empty-state"><div class="empty-icon">⏱</div><div class="empty-text">No recently played tracks</div></div>';
      return;
    }
    
    const seen = new Set();
    const recentAlbums = [];
    this.recentlyPlayed.forEach(t => {
      const key = `${t.album}|||${t.artist}`;
      if (!seen.has(key)) {
        seen.add(key);
        recentAlbums.push({ name: t.album, artist: t.artist, track: t });
      }
    });

    this.gridView.innerHTML = recentAlbums.slice(0, 20).map(album => `
      <div class="album-card" data-id="${album.track.id}">
        <div class="album-art" data-art-id="${album.track.id}">
          <div class="play-overlay"><span>▶</span></div>
        </div>
        <div class="album-title">${this.escapeHtml(album.name || 'Unknown')}</div>
        <div class="album-artist">${this.escapeHtml(album.artist || 'Unknown')}</div>
      </div>
    `).join('');

    this.loadAlbumArt();

    this.gridView.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const index = this.tracks.findIndex(t => t.id === id);
        if (index !== -1) this.playTrack(index);
      });
    });
  }

  renderListView() {
    this.renderListTracks();
  }

  renderListTracks() {
    const tracks = this.currentView === 'recently-played' ? this.recentlyPlayed : this.filteredTracks;
    // Always show checkboxes in list view for selection
    const showCheckboxes = true;
    
    if (tracks.length === 0) {
      this.trackList.innerHTML = '<div class="empty-state" style="height:200px"><div class="empty-text">No tracks</div></div>';
      return;
    }

    this.trackList.innerHTML = tracks.map((track, i) => `
      <div class="track-row ${this.currentTrack?.id === track.id ? 'playing' : ''} ${this.selectedTracks.has(track.id) ? 'selected' : ''}" data-id="${track.id}">
        <div class="col col-check">${showCheckboxes ? `<input type="checkbox" class="track-checkbox" ${this.selectedTracks.has(track.id) ? 'checked' : ''}>` : ''}</div>
        <div class="col col-num">${this.currentTrack?.id === track.id ? '▶' : i + 1}</div>
        <div class="col col-title">${this.escapeHtml(track.title || 'Unknown')}</div>
        <div class="col col-artist">${this.escapeHtml(track.artist || 'Unknown')}</div>
        <div class="col col-album">${this.escapeHtml(track.album || 'Unknown')}</div>
        <div class="col col-genre">${this.escapeHtml(track.genre || '')}</div>
        <div class="col col-duration">${track.durationStr || '—'}</div>
      </div>
    `).join('');

    this.trackList.querySelectorAll('.track-row').forEach((row, i) => {
      // Double click to play
      row.addEventListener('dblclick', () => {
        this.playTrack(i, tracks);
      });
      
      // Single click to toggle selection
      row.addEventListener('click', (e) => {
        // Don't toggle if clicking checkbox directly
        if (e.target.type === 'checkbox') return;
        
        const id = row.dataset.id;
        const checkbox = row.querySelector('.track-checkbox');
        
        if (this.selectedTracks.has(id)) {
          this.selectedTracks.delete(id);
          row.classList.remove('selected');
          if (checkbox) checkbox.checked = false;
        } else {
          this.selectedTracks.add(id);
          row.classList.add('selected');
          if (checkbox) checkbox.checked = true;
        }
        this.updateSyncButtons();
      });
      
      const checkbox = row.querySelector('.track-checkbox');
      if (checkbox) {
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        checkbox.addEventListener('change', (e) => {
          const id = row.dataset.id;
          if (e.target.checked) {
            this.selectedTracks.add(id);
            row.classList.add('selected');
          } else {
            this.selectedTracks.delete(id);
            row.classList.remove('selected');
          }
          this.updateSyncButtons();
        });
      }
    });
  }

  toggleSelectAll(checked) {
    const tracks = this.currentView === 'recently-played' ? this.recentlyPlayed : this.filteredTracks;
    if (checked) {
      tracks.forEach(t => this.selectedTracks.add(t.id));
    } else {
      this.selectedTracks.clear();
    }
    // Update the header checkbox state
    if (this.selectAllCheckbox) {
      this.selectAllCheckbox.checked = checked;
    }
    this.renderListTracks();
    this.updateSyncButtons();
  }

  updateSyncButtons() {
    const hasSelection = this.selectedTracks.size > 0;
    const countText = hasSelection ? ` (${this.selectedTracks.size})` : '';
    
    // Sync to iPod: enabled when has selection and iPod connected (from library only)
    const canSyncToIpod = this.currentSource === 'library' && hasSelection && this.ipodConnected;
    this.syncToIpodBtn.disabled = !canSyncToIpod;
    this.syncToIpodBtn.innerHTML = `<span>↓</span> Sync${countText} to iPod`;
    this.syncToIpodBtn.style.display = this.currentSource === 'library' ? 'flex' : 'none';
    
    // Sync to Library: enabled when viewing iPod or YTM and has selection
    const canSyncToLibrary = (this.currentSource === 'ipod' || this.currentSource === 'ytm') && hasSelection;
    this.syncToLibraryBtn.disabled = !canSyncToLibrary;
    
    if (this.currentSource === 'ytm') {
      this.syncToLibraryBtn.innerHTML = `<span>↓</span> Download${countText}`;
    } else {
      this.syncToLibraryBtn.innerHTML = `<span>↑</span> Sync${countText} to Library`;
    }
    this.syncToLibraryBtn.style.display = (this.currentSource === 'ipod' || this.currentSource === 'ytm') ? 'flex' : 'none';
  }

  async syncToIPod() {
    if (this.selectedTracks.size === 0 || !this.ipodConnected) return;
    
    let trackIds = [...this.selectedTracks];
    
    this.syncToIpodBtn.disabled = true;
    this.showSyncProgress('↓', 'Checking for duplicates...', 0, trackIds.length);
    
    // Check for duplicates first
    try {
      const dupRes = await fetch(`/api/duplicates?source=library&ids=${trackIds.join(',')}`);
      const dupData = await dupRes.json();
      
      if (dupData.duplicates.length > 0) {
        const skipDupes = confirm(
          `${dupData.duplicates.length} of ${trackIds.length} tracks already exist on iPod.\n\n` +
          `Click OK to skip duplicates and sync only ${dupData.unique.length} new tracks.\n` +
          `Click Cancel to sync all (may create duplicates).`
        );
        
        if (skipDupes) {
          trackIds = dupData.unique.map(t => t.id);
          if (trackIds.length === 0) {
            this.hideSyncProgress();
            alert('All selected tracks already exist on iPod!');
            this.syncToIpodBtn.disabled = false;
            this.updateSyncButtons();
            return;
          }
        }
      }
    } catch (e) {
      console.error('Duplicate check failed:', e);
      // Continue with sync anyway
    }
    
    const total = trackIds.length;
    let successCount = 0;
    let failCount = 0;
    
    this.showSyncProgress('↓', 'Preparing sync to iPod...', 0, total);
    
    try {
      for (let i = 0; i < trackIds.length; i++) {
        // Check for cancel
        if (this.syncCancelled) {
          break;
        }
        
        // Wait while paused
        await this.waitWhilePaused();
        if (this.syncCancelled) break;
        
        const trackId = trackIds[i];
        const track = this.tracks.find(t => t.id === trackId);
        const trackName = track?.title || 'Unknown';
        
        this.updateSyncProgress(`Copying "${trackName}"...`, i + 1, total);
        
        try {
          const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackIds: [trackId] })
          });
          const data = await res.json();
          
          if (data.success?.length > 0) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }
      
      this.hideSyncProgress();
      
      if (this.syncCancelled) {
        alert(`Sync stopped.\n\n${successCount} track${successCount !== 1 ? 's' : ''} copied before stopping.`);
      } else if (successCount > 0) {
        alert(`✓ Synced ${successCount} track${successCount !== 1 ? 's' : ''} to iPod!${failCount > 0 ? `\n\n${failCount} failed.` : ''}`);
      } else {
        alert('Sync failed. No tracks were copied.');
      }
      
      if (successCount > 0) {
        this.selectedTracks.clear();
        const status = await fetch('/api/status').then(r => r.json());
        this.updateSourceCounts(status);
      }
      
    } catch (e) {
      console.error('Sync failed:', e);
      this.hideSyncProgress();
      alert('Sync failed. Check console for details.');
    }
    
    this.updateSyncButtons();
    this.renderView();
  }

  async syncToLibrary() {
    if (this.selectedTracks.size === 0) return;

    // Handle YTM downloads separately
    if (this.currentSource === 'ytm') {
      this.downloadYtmTracks([...this.selectedTracks]);
      return;
    }

    // Sync directly to library
    await this.performSyncToLibrary();
  }
  
  async performSyncToLibrary() {
    let trackIds = [...this.selectedTracks];

    this.syncToLibraryBtn.disabled = true;
    this.showSyncProgress('↑', 'Checking for duplicates...', 0, trackIds.length);

    // Check for duplicates first
    try {
      const dupRes = await fetch(`/api/duplicates?source=ipod&ids=${trackIds.join(',')}`);
      const dupData = await dupRes.json();

      if (dupData.duplicates.length > 0) {
        const skipDupes = confirm(
          `${dupData.duplicates.length} of ${trackIds.length} tracks already exist in library.\n\n` +
          `Click OK to skip duplicates and sync only ${dupData.unique.length} new tracks.\n` +
          `Click Cancel to sync all (may create duplicates).`
        );

        if (skipDupes) {
          trackIds = dupData.unique.map(t => t.id);
          if (trackIds.length === 0) {
            this.hideSyncProgress();
            alert('All selected tracks already exist in library!');
            this.syncToLibraryBtn.disabled = false;
            this.updateSyncButtons();
            return;
          }
        }
      }
    } catch (e) {
      console.error('Duplicate check failed:', e);
      // Continue with sync anyway
    }

    const total = trackIds.length;
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    this.showSyncProgress('↑', 'Syncing to library...', 0, total);

    try {
      for (let i = 0; i < trackIds.length; i++) {
        // Check for cancel
        if (this.syncCancelled) {
          break;
        }

        // Wait while paused
        await this.waitWhilePaused();
        if (this.syncCancelled) break;

        const trackId = trackIds[i];
        const track = this.ipodTracks.find(t => t.id === trackId);
        const trackName = track?.title || 'Unknown';

        this.updateSyncProgress(`Copying "${trackName}"...`, i + 1, total);

        try {
          const res = await fetch('/api/sync/to-library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackIds: [trackId] })
          });
          const data = await res.json();

          if (data.success?.length > 0) {
            successCount++;
          } else if (data.failed?.[0]?.error === 'File already exists') {
            skippedCount++;
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }

      this.hideSyncProgress();

      if (this.syncCancelled) {
        alert(`Sync stopped.\n\n${successCount} track${successCount !== 1 ? 's' : ''} copied before stopping.`);
      } else {
        let message = '';
        if (successCount > 0) {
          message = `✓ Synced ${successCount} track${successCount !== 1 ? 's' : ''} to library!`;
        }
        if (skippedCount > 0) {
          message += `${message ? '\n\n' : ''}${skippedCount} already existed (skipped).`;
        }
        if (failCount > 0) {
          message += `${message ? '\n\n' : ''}${failCount} failed.`;
        }
        if (!message) {
          message = 'No tracks were copied.';
        }
        alert(message);
      }

      if (successCount > 0) {
        this.selectedTracks.clear();
        const status = await fetch('/api/status').then(r => r.json());
        this.updateSourceCounts(status);
      }

    } catch (e) {
      console.error('Sync to library failed:', e);
      this.hideSyncProgress();
      alert('Sync failed. Check console for details.');
    }

    this.updateSyncButtons();
    this.renderView();
  }

  get currentTrack() {
    return this.currentIndex >= 0 ? this.playQueue?.[this.currentIndex] : null;
  }

  playTrack(index, queue = null) {
    if (queue) {
      this.playQueue = queue;
    }
    if (!this.playQueue || index < 0 || index >= this.playQueue.length) return;
    
    this.currentIndex = index;
    const track = this.playQueue[index];
    
    // Use YTM stream endpoint for YouTube Music tracks
    if (track.source === 'ytm' && track.videoId) {
      this.audio.src = `/api/ytm/stream/${track.videoId}`;
    } else {
      this.audio.src = `/audio/${track.id}`;
    }
    this.audio.play();
    
    this.nowTitle.textContent = track.title || 'Unknown';
    this.nowArtist.textContent = track.artist || 'Unknown';
    
    // Show the now playing info, hide the logo
    document.getElementById('nowPlaying').classList.add('playing');
    
    this.updateNowPlayingArt(track.id, track.thumbnail);
    
    this.recentlyPlayed = [track, ...this.recentlyPlayed.filter(t => t.id !== track.id)].slice(0, 50);
    
    if (this.viewMode === 'list') {
      this.renderListTracks();
    }
    
    document.title = `▶ ${track.title} - ${track.artist} | yTunes`;
    
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album
      });
    }
  }

  togglePlay() {
    if (!this.playQueue || this.playQueue.length === 0) {
      if (this.albums.length > 0) {
        this.playTrack(0, this.albums[0].tracks);
      }
      return;
    }
    
    if (this.currentIndex === -1) {
      this.playTrack(0);
    } else if (this.isPlaying) {
      this.audio.pause();
    } else {
      this.audio.play();
    }
  }

  setPlayingState(playing) {
    this.isPlaying = playing;
    this.playBtn.classList.toggle('playing', playing);
    if (!playing && this.currentTrack) {
      document.title = `${this.currentTrack.title} - ${this.currentTrack.artist} | yTunes`;
    }
  }

  prev() {
    if (!this.playQueue || this.playQueue.length === 0) return;
    const newIndex = this.currentIndex <= 0 ? this.playQueue.length - 1 : this.currentIndex - 1;
    this.playTrack(newIndex);
  }

  next() {
    if (!this.playQueue || this.playQueue.length === 0) return;
    const newIndex = this.currentIndex >= this.playQueue.length - 1 ? 0 : this.currentIndex + 1;
    this.playTrack(newIndex);
  }

  seek(value) {
    if (this.audio.duration) {
      this.audio.currentTime = (value / 100) * this.audio.duration;
    }
  }

  setVolume(value) {
    this.audio.volume = value / 100;
  }

  updateProgress() {
    if (this.audio.duration) {
      const percent = (this.audio.currentTime / this.audio.duration) * 100;
      this.progress.value = percent;
      this.currentTimeEl.textContent = this.formatTime(this.audio.currentTime);
    }
  }

  updateDuration() {
    this.durationEl.textContent = this.formatTime(this.audio.duration);
  }

  search(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.filteredTracks = [...this.tracks];
      this.processLibrary();
    } else {
      this.filteredTracks = this.tracks.filter(t => 
        (t.title || '').toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q) ||
        (t.album || '').toLowerCase().includes(q) ||
        (t.genre || '').toLowerCase().includes(q)
      );
      
      const albumMap = new Map();
      this.filteredTracks.forEach(t => {
        const key = `${t.album}|||${t.artist}`;
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            name: t.album || 'Unknown Album',
            artist: t.artist || 'Unknown Artist',
            tracks: []
          });
        }
        albumMap.get(key).tracks.push(t);
      });
      this.albums = [...albumMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    this.sortTracks();
    this.renderView();
  }

  sortBy(column) {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }
    this.sortTracks();
    this.renderListTracks();
  }

  sortTracks() {
    this.filteredTracks.sort((a, b) => {
      // Primary sort by selected column
      let valA = a[this.sortColumn] || '';
      let valB = b[this.sortColumn] || '';
      
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      
      const primaryCompare = valA < valB ? -1 : valA > valB ? 1 : 0;
      if (primaryCompare !== 0) {
        return this.sortAsc ? primaryCompare : -primaryCompare;
      }
      
      // Secondary sort: within same primary value, sort by album then track number then title
      const albumA = (a.album || '').toLowerCase();
      const albumB = (b.album || '').toLowerCase();
      if (albumA !== albumB) return albumA.localeCompare(albumB);
      
      // Track number (parse as int for proper numeric sort)
      const trackA = parseInt(a.track) || 999;
      const trackB = parseInt(b.track) || 999;
      if (trackA !== trackB) return trackA - trackB;
      
      // Finally by title
      const titleA = (a.title || '').toLowerCase();
      const titleB = (b.title || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });
  }

  updateTrackCount() {
    this.trackCountEl.textContent = `${this.tracks.length} songs`;
    
    const totalSeconds = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    if (totalSeconds > 0) {
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      this.totalTimeEl.textContent = hours > 0 
        ? `${hours} hours, ${mins} minutes` 
        : `${mins} minutes`;
    }
  }

  async eject() {
    if (!this.ipodConnected) return;
    
    this.audio.pause();
    this.audio.src = '';
    
    this.ejectBtn.disabled = true;
    const originalText = this.ejectBtn.innerHTML;
    this.ejectBtn.innerHTML = 'Ejecting...';
    
    try {
      const res = await fetch('/api/eject');
      const data = await res.json();
      
      if (data.success) {
        this.ipodConnected = false;
        this.ipodTracks = [];
        
        if (this.currentSource === 'ipod') {
          this.tracks = [];
          this.albums = [];
          this.artists = [];
          this.filteredTracks = [];
        }
        
        this.playQueue = [];
        this.currentIndex = -1;
        
        this.updateConnectionStatus({ connected: false });
        this.ipodCountEl.textContent = '0';
        this.renderView();
        this.updateTrackCount();
        
        this.nowTitle.textContent = 'iPod ejected';
        this.nowArtist.textContent = 'Safe to disconnect';
        this.albumArt.style.backgroundImage = '';
        
        this.deviceName.textContent = '✓ Ejected';
        setTimeout(() => {
          this.deviceName.textContent = 'No Device';
        }, 2000);
      } else {
        alert(`Failed to eject: ${data.error}\n\nMake sure no files are in use.`);
      }
    } catch (e) {
      console.error('Eject failed:', e);
      alert('Failed to eject device. Try again.');
    }
    
    this.ejectBtn.disabled = false;
    this.ejectBtn.innerHTML = originalText;
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  hashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '00000'.substring(0, 6 - c.length) + c;
  }

  emptyState() {
    return `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <div class="empty-text">${this.tracks.length === 0 ? 'No music found' : 'No results'}</div>
      </div>
    `;
  }

  loadAlbumArt() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const trackId = el.dataset.artId;
          if (trackId && !el.dataset.loaded) {
            el.dataset.loaded = 'true';
            const img = new Image();
            img.onload = () => {
              el.style.backgroundImage = `url(/art/${trackId})`;
              el.classList.add('has-art');
            };
            img.src = `/art/${trackId}`;
          }
          observer.unobserve(el);
        }
      });
    }, { rootMargin: '100px' });

    document.querySelectorAll('.album-art[data-art-id]').forEach(el => {
      observer.observe(el);
    });
  }

  updateNowPlayingArt(trackId, thumbnail = null) {
    if (thumbnail) {
      // Use YTM thumbnail directly
      const img = new Image();
      img.onload = () => {
        this.albumArt.style.backgroundImage = `url(${thumbnail})`;
      };
      img.onerror = () => {
        this.albumArt.style.backgroundImage = '';
      };
      img.src = thumbnail;
    } else if (trackId) {
      const img = new Image();
      img.onload = () => {
        this.albumArt.style.backgroundImage = `url(/art/${trackId})`;
      };
      img.onerror = () => {
        this.albumArt.style.backgroundImage = '';
      };
      img.src = `/art/${trackId}`;
    }
  }
}

// Initialize
const ytunes = new Ytunes();

// Media Session handlers
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => ytunes.togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => ytunes.togglePlay());
  navigator.mediaSession.setActionHandler('previoustrack', () => ytunes.prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => ytunes.next());
}

console.log('🦞 yTunes loaded');
