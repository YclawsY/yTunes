#!/usr/bin/env node
// yTunes Server - Auto-connects to iPod and serves music
// 🦞 Built by Molty

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const PORT = 8888;

// Initialize SQLite database for metadata caching
const dbPath = path.join(__dirname, 'ytunes-library.db');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    full_path TEXT NOT NULL,
    size INTEGER,
    mtime INTEGER,
    source TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    album TEXT,
    genre TEXT,
    track TEXT,
    year TEXT,
    duration REAL,
    indexed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
  CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
  
  CREATE TABLE IF NOT EXISTS album_art (
    id TEXT PRIMARY KEY,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    art_path TEXT,
    fetched_at INTEGER,
    not_found INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_album_art_lookup ON album_art(artist, album);
  
  CREATE TABLE IF NOT EXISTS genre_art (
    genre TEXT PRIMARY KEY,
    art_path TEXT,
    generated_at INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  
  CREATE TABLE IF NOT EXISTS ytm_tracks (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration REAL,
    thumbnail TEXT,
    playlist_id TEXT,
    playlist_name TEXT,
    indexed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_ytm_tracks_playlist ON ytm_tracks(playlist_id);

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_playlists_source ON playlists(source);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
`);

// YouTube Music state
let ytmCookiesPath = null;
let ytmLibrary = [];
let ytmPlaylists = [];
let ytmFetchProgress = { active: false, current: 0, total: 0 };
let ytmDownloadProgress = { active: false, current: 0, total: 0, completed: 0 };

// yt-dlp path
const ytdlpPath = process.env.YTDLP_PATH || path.join(process.env.HOME, '.local/bin/yt-dlp');

// YouTube Music statements
const ytmStmts = {
  getTrack: db.prepare('SELECT * FROM ytm_tracks WHERE id = ?'),
  getTrackByVideoId: db.prepare('SELECT * FROM ytm_tracks WHERE video_id = ?'),
  upsertTrack: db.prepare(`
    INSERT OR REPLACE INTO ytm_tracks (id, video_id, title, artist, album, duration, thumbnail, playlist_id, playlist_name, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getAllTracks: db.prepare('SELECT * FROM ytm_tracks ORDER BY artist, album, title'),
  getTracksByPlaylist: db.prepare('SELECT * FROM ytm_tracks WHERE playlist_id = ?'),
  getPlaylists: db.prepare('SELECT DISTINCT playlist_id, playlist_name FROM ytm_tracks WHERE playlist_id IS NOT NULL'),
  deleteAll: db.prepare('DELETE FROM ytm_tracks'),
  countTracks: db.prepare('SELECT COUNT(*) as count FROM ytm_tracks')
};

// Prepared statements for performance
const stmts = {
  getTrack: db.prepare('SELECT * FROM tracks WHERE id = ?'),
  getTrackByPath: db.prepare('SELECT * FROM tracks WHERE path = ? AND source = ?'),
  upsertTrack: db.prepare(`
    INSERT OR REPLACE INTO tracks (id, path, full_path, size, mtime, source, title, artist, album, genre, track, year, duration, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getTracksBySource: db.prepare('SELECT * FROM tracks WHERE source = ?'),
  deleteBySource: db.prepare('DELETE FROM tracks WHERE source = ?'),
  deleteById: db.prepare('DELETE FROM tracks WHERE id = ?'),
  countBySource: db.prepare('SELECT COUNT(*) as count FROM tracks WHERE source = ?'),
  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  // Genre art
  getGenreArt: db.prepare('SELECT * FROM genre_art WHERE genre = ?'),
  upsertGenreArt: db.prepare('INSERT OR REPLACE INTO genre_art (genre, art_path, generated_at) VALUES (?, ?, ?)'),
  getAllGenres: db.prepare("SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL AND genre != ''"),
  getMissingGenreArt: db.prepare(`
    SELECT DISTINCT COALESCE(NULLIF(t.genre, ''), 'Unknown') as genre
    FROM tracks t 
    LEFT JOIN genre_art g ON LOWER(COALESCE(NULLIF(t.genre, ''), 'Unknown')) = LOWER(g.genre)
    WHERE g.genre IS NULL
  `),
  countMissingGenreArt: db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(t.genre, ''), 'Unknown')) as count
    FROM tracks t
    LEFT JOIN genre_art g ON LOWER(COALESCE(NULLIF(t.genre, ''), 'Unknown')) = LOWER(g.genre)
    WHERE g.genre IS NULL
  `)
};

// Playlist prepared statements
const playlistStmts = {
  getPlaylistsBySource: db.prepare('SELECT * FROM playlists WHERE source = ? ORDER BY created_at DESC'),
  getPlaylist: db.prepare('SELECT * FROM playlists WHERE id = ?'),
  createPlaylist: db.prepare('INSERT INTO playlists (id, name, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
  deletePlaylist: db.prepare('DELETE FROM playlists WHERE id = ?'),
  renamePlaylist: db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?'),
  getPlaylistTracks: db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'),
  addTrackToPlaylist: db.prepare('INSERT INTO playlist_tracks (id, playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?, ?)'),
  removeTrackFromPlaylist: db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'),
  getMaxPosition: db.prepare('SELECT MAX(position) as max FROM playlist_tracks WHERE playlist_id = ?')
};

// Find unmounted iPod/MP3 player devices
function findUnmountedDevices() {
  const devices = [];
  try {
    // Use lsblk to find unmounted block devices
    const result = execSync(
      'lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,LABEL,MODEL,TRAN',
      { encoding: 'utf8', timeout: 5000 }
    );
    const data = JSON.parse(result);
    
    for (const device of data.blockdevices || []) {
      // Skip loop devices and mounted root devices
      if (device.type === 'loop' || device.name.startsWith('loop')) continue;
      
      // Check if this looks like an iPod or removable device
      const isUsb = device.tran === 'usb';
      const isIpod = (device.model || '').toLowerCase().includes('ipod') ||
                     (device.label || '').toLowerCase().includes('ipod');
      
      if (isUsb || isIpod) {
        // Check partitions
        const partitions = device.children || [];
        for (const part of partitions) {
          if (!part.mountpoint && part.type === 'part') {
            devices.push({
              device: `/dev/${part.name}`,
              name: device.label || device.model || part.name,
              size: part.size,
              isIpod: isIpod
            });
          }
        }
        // Also check if the device itself is unmounted (no partitions)
        if (partitions.length === 0 && !device.mountpoint) {
          devices.push({
            device: `/dev/${device.name}`,
            name: device.label || device.model || device.name,
            size: device.size,
            isIpod: isIpod
          });
        }
      }
    }
  } catch (e) {
    console.error('Error finding unmounted devices:', e.message);
  }
  return devices;
}

// Try to mount a device using udisksctl (no sudo needed)
function mountDevice(devicePath) {
  try {
    const result = execSync(
      `udisksctl mount -b ${devicePath}`,
      { encoding: 'utf8', timeout: 30000 }
    );
    // Parse mount point from output like "Mounted /dev/sda1 at /media/user/iPod"
    const match = result.match(/Mounted .+ at (.+)/);
    if (match) {
      return { success: true, mountPoint: match[1].trim() };
    }
    return { success: true, mountPoint: null };
  } catch (e) {
    // Check if already mounted
    if (e.message.includes('AlreadyMounted')) {
      // Try to find existing mount point
      try {
        const mountPoint = execSync(
          `findmnt -n -o TARGET ${devicePath}`,
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        if (mountPoint) {
          return { success: true, mountPoint, alreadyMounted: true };
        }
      } catch (findErr) {
        // Couldn't find mount point
      }
      return { success: false, error: 'Device is already mounted. Click "Refresh Devices" to detect it.' };
    }
    return { success: false, error: e.message };
  }
}

// Find mounted iPod
function findIPod() {
  const mediaPath = '/media';
  const mntPath = '/mnt';
  
  const searchPaths = [];
  
  // Check /media/*/
  if (fs.existsSync(mediaPath)) {
    for (const user of fs.readdirSync(mediaPath)) {
      const userPath = path.join(mediaPath, user);
      try {
        if (fs.statSync(userPath).isDirectory()) {
          for (const mount of fs.readdirSync(userPath)) {
            searchPaths.push(path.join(userPath, mount));
          }
        }
      } catch (e) {
        // Permission denied, skip
      }
    }
  }
  
  // Check /mnt/
  if (fs.existsSync(mntPath)) {
    for (const mount of fs.readdirSync(mntPath)) {
      searchPaths.push(path.join(mntPath, mount));
    }
  }
  
  // Look for iPod_Control folder
  for (const mountPoint of searchPaths) {
    const ipodControl = path.join(mountPoint, 'iPod_Control');
    if (fs.existsSync(ipodControl)) {
      return mountPoint;
    }
  }
  
  return null;
}

// Album art cache directory
const artCacheDir = path.join(__dirname, 'album-art');
if (!fs.existsSync(artCacheDir)) {
  fs.mkdirSync(artCacheDir, { recursive: true });
}

// Album art prepared statements
const artStmts = {
  getArt: db.prepare('SELECT * FROM album_art WHERE artist = ? AND album = ?'),
  upsertArt: db.prepare(`
    INSERT OR REPLACE INTO album_art (id, artist, album, art_path, fetched_at, not_found)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getMissingArt: db.prepare(`
    SELECT DISTINCT t.artist, t.album 
    FROM tracks t 
    LEFT JOIN album_art a ON LOWER(t.artist) = LOWER(a.artist) AND LOWER(t.album) = LOWER(a.album)
    WHERE a.id IS NULL OR (a.art_path IS NULL AND a.not_found = 0)
    LIMIT 100
  `),
  countMissingArt: db.prepare(`
    SELECT COUNT(DISTINCT t.artist || '|||' || t.album) as count
    FROM tracks t 
    LEFT JOIN album_art a ON LOWER(t.artist) = LOWER(a.artist) AND LOWER(t.album) = LOWER(a.album)
    WHERE a.id IS NULL OR (a.art_path IS NULL AND a.not_found = 0)
  `)
};

// Fetch album art using MusicBrainz + Cover Art Archive
async function fetchAlbumArt(artist, album) {
  const https = require('https');
  
  // First, search MusicBrainz for the release
  const query = encodeURIComponent(`release:"${album}" AND artist:"${artist}"`);
  
  const searchOptions = {
    hostname: 'musicbrainz.org',
    path: `/ws/2/release?query=${query}&limit=1&fmt=json`,
    headers: {
      'User-Agent': 'yTunes/1.0 (https://github.com/YclawsY/yTunes)'
    }
  };
  
  return new Promise((resolve) => {
    https.get(searchOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          if (json.releases && json.releases.length > 0) {
            const releaseId = json.releases[0].id;
            
            // Now get cover art from Cover Art Archive
            const artUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
            
            // Check if art exists (CAA returns redirect or 404)
            const checkOptions = {
              hostname: 'coverartarchive.org',
              path: `/release/${releaseId}/front-500`,
              method: 'HEAD',
              headers: {
                'User-Agent': 'yTunes/1.0 (https://github.com/YclawsY/yTunes)'
              }
            };
            
            https.request(checkOptions, (checkRes) => {
              if (checkRes.statusCode === 200 || checkRes.statusCode === 307 || checkRes.statusCode === 302) {
                resolve(artUrl);
              } else {
                resolve(null);
              }
            }).on('error', () => resolve(null)).end();
            
          } else {
            resolve(null);
          }
        } catch (e) {
          console.error('Failed to parse MusicBrainz response:', e.message);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error('MusicBrainz API error:', e.message);
      resolve(null);
    });
  });
}

// Download and cache album art (handles redirects)
async function downloadAlbumArt(artist, album, artUrl) {
  const https = require('https');
  const http = require('http');
  
  // Create safe filename
  const safeArtist = artist.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const safeAlbum = album.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const filename = `${safeArtist}_${safeAlbum}.jpg`;
  const filepath = path.join(artCacheDir, filename);
  
  const downloadWithRedirect = (url, redirectCount = 0) => {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve(null);
        return;
      }
      
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'yTunes/1.0 (https://github.com/YclawsY/yTunes)'
        }
      };
      
      protocol.get(options, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            downloadWithRedirect(redirectUrl, redirectCount + 1).then(resolve);
            return;
          }
        }
        
        if (res.statusCode === 200) {
          const file = fs.createWriteStream(filepath);
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(filepath);
          });
          file.on('error', () => {
            file.close();
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            resolve(null);
          });
        } else {
          resolve(null);
        }
      }).on('error', () => resolve(null));
    });
  };
  
  return downloadWithRedirect(artUrl);
}

// Album art fetch progress tracking
let artFetchProgress = {
  active: false,
  current: 0,
  total: 0,
  found: 0
};

// Genre art generation progress tracking
let genreArtProgress = {
  active: false,
  current: 0,
  total: 0,
  generated: 0
};

// Genre art cache directory
const genreArtDir = path.join(__dirname, 'genre-art');
if (!fs.existsSync(genreArtDir)) {
  fs.mkdirSync(genreArtDir, { recursive: true });
}

// Style reference image URL for genre art
const STYLE_REFERENCE_URL = 'https://i.redd.it/1vz6xfxkkcz51.jpg';

// Load style reference image as base64
const styleRefPath = path.join(__dirname, 'style-reference.jpg');
let styleRefBase64 = null;
if (fs.existsSync(styleRefPath)) {
  const imgBuffer = fs.readFileSync(styleRefPath);
  styleRefBase64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
  console.log('📸 Loaded style reference image for genre art generation');
}

// Genre descriptions for better image generation
const genreDescriptions = {
  'rock': 'energetic guitar-driven music with powerful drums and rebellion attitude',
  'alternative': 'experimental indie sound with unconventional structures and introspective lyrics',
  'pop': 'catchy upbeat melodies with danceable hooks and mainstream appeal',
  'country': 'acoustic guitars, fiddles, and storytelling about rural life and heartbreak',
  'hip hop/rap': 'rhythmic beats, sampling, and lyrical flow from urban culture',
  'hip-hop/rap': 'rhythmic beats, sampling, and lyrical flow from urban culture',
  'rap': 'fast-paced lyrical delivery over heavy bass beats',
  'r&b/soul': 'smooth vocals with emotional depth and groove-based rhythms',
  'r&b': 'rhythm and blues with soulful vocals and sensual melodies',
  'jazz': 'improvisation, swing rhythms, and sophisticated harmonies',
  'blues': 'emotional guitar licks and soulful vocals expressing hardship',
  'classical': 'orchestral compositions with complex arrangements and timeless elegance',
  'electronic': 'synthesizers, drum machines, and futuristic digital sounds',
  'dance': 'high-energy beats designed to move your body on the dancefloor',
  'metal': 'heavy distorted guitars, aggressive drums, and intense energy',
  'hard rock': 'loud amplified guitars with driving rhythms and attitude',
  'punk': 'fast, raw, and rebellious with DIY attitude',
  'reggae': 'laid-back offbeat rhythms from Jamaica with positive vibes',
  'folk': 'acoustic storytelling with traditional instruments and heritage',
  'soundtrack': 'cinematic orchestral music that accompanies visual storytelling',
  'latin': 'passionate rhythms with salsa, merengue, and tropical flavors',
  'children\'s music': 'playful sing-along songs with educational and fun themes',
  'christian & gospel': 'spiritual worship music with uplifting messages of faith',
  'singer/songwriter': 'intimate acoustic performances with personal lyrics',
  'soft rock': 'mellow melodic rock with gentle vocals and smooth production',
  'easy listening': 'relaxing instrumental melodies for peaceful ambiance',
  'oldies': 'classic hits from the 50s and 60s that defined an era',
  'doo wop': 'vocal harmony groups with romantic themes from the 1950s',
  'disco': 'four-on-the-floor beats with funky basslines and glamour',
  'funk': 'syncopated grooves with slap bass and rhythmic horn sections',
  'new wave': '80s synth-pop with angular guitars and artsy aesthetics',
  'grunge': 'raw distorted guitars with angst-filled lyrics from Seattle',
  'indie': 'independent spirit with unique sounds outside mainstream',
  'electronica/dance': 'electronic beats and synthesizers for club environments',
  'vocal': 'focus on the human voice as the primary instrument',
  'urban cowboy': 'country music with pop and rock crossover appeal',
  'unknown': 'eclectic mix of musical styles, mysterious and undefined',
  'other': 'unique sounds that defy categorization'
};

function getGenreDescription(genre) {
  const key = genre.toLowerCase();
  return genreDescriptions[key] || `music in the ${genre} style`;
}

// Generate genre art using OpenRouter API via chat completions with image modality (with retry)
async function generateGenreArt(genre, apiKey, retries = 3) {
  const https = require('https');
  
  const description = getGenreDescription(genre);
  
  const prompt = `Generate an album cover art image in the classic iPod advertisement style for the music genre "${genre}" (${description}).

STYLE REQUIREMENTS (match the reference image exactly):
- A solid BLACK SILHOUETTE of a CRUSTACEAN (lobster, crab, or shrimp) against a single BRIGHT SOLID COLOR background
- The crustacean silhouette is wearing white earbuds/headphones with a white cord connected to a small white music player
- Clean, bold, iconic graphic design like the original iPod ads

THE CRUSTACEAN SHOULD EVOKE THE ESSENCE OF ${genre.toUpperCase()} MUSIC:
- The crustacean's pose, energy, and movement should instantly communicate "${genre}" to the viewer
- For energetic genres: dynamic poses, jumping, rocking out
- For smooth genres: cool relaxed poses, grooving
- For mellow genres: peaceful swaying, gentle movement
- Choose a background color that emotionally represents ${genre} (e.g. fiery orange/red for rock, cool blue for electronic, warm yellow for pop, deep purple for r&b, green for reggae, pink for pop)
- The overall feeling should capture what it's like to listen to ${genre} music - the emotion, the energy, the vibe

CRITICAL: DO NOT include ANY text, words, letters, numbers, or typography anywhere in the image. The image must be completely free of any written content.

Create an iconic, instantly recognizable image of a crustacean enjoying ${genre} music in the classic iPod silhouette style.`;

  // Build message content with style reference image
  const content = [];
  
  // Add text prompt first
  content.push({
    type: 'text',
    text: prompt
  });
  
  // Add style reference image if available
  if (styleRefBase64) {
    content.push({
      type: 'image_url',
      image_url: {
        url: styleRefBase64
      }
    });
  }
  
  const requestBody = JSON.stringify({
    model: 'google/gemini-2.5-flash-image',
    messages: [
      {
        role: 'user',
        content: content
      }
    ],
    modalities: ['image', 'text']
  });
  
  const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/YclawsY/yTunes',
      'X-Title': 'yTunes',
      'Content-Length': Buffer.byteLength(requestBody)
    }
  };
  
  const attemptGeneration = () => new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          
          // Check for errors
          if (json.error) {
            console.error('OpenRouter API error:', json.error.message || json.error);
            resolve({ error: true, retryable: json.error.code === 'rate_limit' || json.error.code === 'timeout' });
            return;
          }
          
          // Extract image from response
          if (json.choices && json.choices[0]?.message?.images) {
            const images = json.choices[0].message.images;
            if (images.length > 0 && images[0].image_url?.url) {
              // It's a base64 data URL
              const dataUrl = images[0].image_url.url;
              if (dataUrl.startsWith('data:image')) {
                // Extract base64 part
                const base64Data = dataUrl.split(',')[1];
                resolve({ b64: base64Data });
              } else {
                resolve({ url: dataUrl });
              }
              return;
            }
          }
          
          console.log('No image in response:', JSON.stringify(json).substring(0, 200));
          resolve({ error: true, retryable: true });
        } catch (e) {
          console.error('Failed to parse OpenRouter response:', e.message, data.substring(0, 200));
          resolve({ error: true, retryable: true });
        }
      });
    });
    
    req.on('error', (e) => {
      console.error('OpenRouter request error:', e.message);
      resolve({ error: true, retryable: true });
    });
    
    req.write(requestBody);
    req.end();
  });
  
  // Retry with exponential backoff
  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await attemptGeneration();
    
    if (!result.error) {
      return result; // Success
    }
    
    if (!result.retryable || attempt === retries - 1) {
      return null; // Give up
    }
    
    // Exponential backoff: 1s, 2s, 4s...
    const delay = Math.pow(2, attempt) * 1000;
    console.log(`  ⏳ Retrying ${genre} in ${delay/1000}s (attempt ${attempt + 2}/${retries})`);
    await new Promise(r => setTimeout(r, delay));
  }
  
  return null;
}

// Save genre art (from URL or base64)
async function saveGenreArt(genre, imageData) {
  const safeGenre = genre.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const filename = `${safeGenre}.png`;
  const filepath = path.join(genreArtDir, filename);
  
  if (imageData.b64) {
    // Save from base64
    const buffer = Buffer.from(imageData.b64, 'base64');
    fs.writeFileSync(filepath, buffer);
    return filepath;
  } else if (imageData.url) {
    // Download from URL
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve) => {
      const parsedUrl = new URL(imageData.url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      protocol.get(imageData.url, (res) => {
        if (res.statusCode === 200) {
          const file = fs.createWriteStream(filepath);
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(filepath);
          });
        } else {
          resolve(null);
        }
      }).on('error', () => resolve(null));
    });
  }
  
  return null;
}

// Extract metadata using ffprobe
function getMetadata(filePath) {
  try {
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_format "${filePath}"`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const data = JSON.parse(result);
    const tags = data.format?.tags || {};
    
    return {
      title: tags.title || tags.TITLE || path.basename(filePath, path.extname(filePath)),
      artist: tags.artist || tags.ARTIST || tags.album_artist || 'Unknown Artist',
      album: tags.album || tags.ALBUM || 'Unknown Album',
      genre: tags.genre || tags.GENRE || '',
      track: tags.track || tags.TRACK || '',
      year: tags.date?.substring(0, 4) || tags.year || '',
      duration: parseFloat(data.format?.duration) || 0
    };
  } catch (e) {
    return {
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      genre: '',
      track: '',
      year: '',
      duration: 0
    };
  }
}

// Scan iPod music folder
function scanIPod(ipodPath) {
  const musicPath = path.join(ipodPath, 'iPod_Control', 'Music');
  const tracks = [];
  
  if (!fs.existsSync(musicPath)) {
    return tracks;
  }
  
  const folders = fs.readdirSync(musicPath).filter(f => f.startsWith('F'));
  
  for (const folder of folders) {
    const folderPath = path.join(musicPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    
    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      if (!/\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(file)) continue;
      
      const filePath = path.join(folderPath, file);
      const relativePath = path.relative(ipodPath, filePath);
      const stats = fs.statSync(filePath);
      
      tracks.push({
        id: Buffer.from(relativePath).toString('base64url'),
        path: relativePath,
        fullPath: filePath,
        size: stats.size,
        metadata: null // Lazy load
      });
    }
  }
  
  return tracks;
}

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac'
};

// State
let ipodPath = null;
let ipodName = null;
let ipodTracks = [];
let localTracks = [];
let metadataCache = new Map();

// Fixed library path
const os = require('os');
const LIBRARY_PATH = path.join(os.homedir(), 'Music', 'yTunes');

// Get iPod name from iTunesPrefs
function getIPodName(ipodPath) {
  try {
    const prefsPath = path.join(ipodPath, 'iPod_Control', 'iTunes', 'iTunesPrefs');
    if (fs.existsSync(prefsPath)) {
      const data = fs.readFileSync(prefsPath);
      // Look for readable strings - name is usually near the start
      const str = data.toString('binary');
      // Find patterns like "Name\0\0\0..." - the name is usually stored as a null-padded string
      const matches = str.match(/([A-Za-z][A-Za-z0-9 .'_-]{1,30})/g);
      if (matches && matches.length > 0) {
        // Filter out common false positives
        const filtered = matches.filter(m => 
          !m.match(/^(frpd|JKING|PC|iTunes|Music|Video|Photo|Podcast|Game)$/i) &&
          m.length > 2
        );
        if (filtered.length > 0) {
          return filtered[0];
        }
      }
    }
  } catch (e) {
    console.error('Failed to read iPod name:', e);
  }
  return null;
}

// Config file for persisting settings
const configPath = path.join(__dirname, 'ytunes-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config;
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// Scan local music folder and index to database
function scanLocalLibrary(libraryPath, forceReindex = false) {
  if (!libraryPath || !fs.existsSync(libraryPath)) {
    return [];
  }
  
  const existingTracks = new Set();
  const now = Date.now();
  let indexed = 0;
  let skipped = 0;
  
  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (/\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(entry.name)) {
          const relativePath = path.relative(libraryPath, fullPath);
          const id = 'local_' + Buffer.from(relativePath).toString('base64url');
          existingTracks.add(id);
          
          const stats = fs.statSync(fullPath);
          const mtime = Math.floor(stats.mtimeMs);
          
          // Check if already indexed and unchanged
          const existing = stmts.getTrack.get(id);
          if (existing && existing.mtime === mtime && !forceReindex) {
            skipped++;
            continue;
          }
          
          // Get metadata and index
          const meta = getMetadata(fullPath);
          stmts.upsertTrack.run(
            id, relativePath, fullPath, stats.size, mtime, 'local',
            meta.title, meta.artist, meta.album, meta.genre, meta.track, meta.year, meta.duration, now
          );
          indexed++;
        }
      }
    } catch (e) {
      console.error('Scan error:', e);
    }
  }
  
  console.log('📁 Scanning local library:', libraryPath);
  scanDir(libraryPath);
  
  // Clean up deleted files from database
  const dbTracks = stmts.getTracksBySource.all('local');
  for (const track of dbTracks) {
    if (!existingTracks.has(track.id)) {
      stmts.deleteById.run(track.id);
    }
  }
  
  if (indexed > 0) {
    console.log(`✓ Indexed ${indexed} new/updated tracks`);
  }
  
  // Return tracks from database
  return stmts.getTracksBySource.all('local');
}

// Get local tracks from database (fast!)
function getLocalTracks() {
  return stmts.getTracksBySource.all('local');
}

// Get local track count
function getLocalTrackCount() {
  return stmts.countBySource.get('local').count;
}

// Initialize
function init() {
  loadConfig();

  // Auto-create library path if it doesn't exist
  if (!fs.existsSync(LIBRARY_PATH)) {
    fs.mkdirSync(LIBRARY_PATH, { recursive: true });
    console.log(`📁 Created library folder: ${LIBRARY_PATH}`);
  }

  ipodPath = findIPod();
  if (ipodPath) {
    console.log(`🎵 Found iPod at: ${ipodPath}`);
    ipodName = getIPodName(ipodPath);
    if (ipodName) {
      console.log(`📱 iPod name: ${ipodName}`);
    }
    ipodTracks = scanIPod(ipodPath);
    console.log(`📀 Found ${ipodTracks.length} tracks on iPod`);
  } else {
    console.log('⚠️  No iPod found. Connect one and restart.');
    ipodTracks = [];
    ipodName = null;
  }

  // Scan library path
  localTracks = scanLocalLibrary(LIBRARY_PATH);
  console.log(`🎵 Found ${getLocalTrackCount()} local tracks`);
}

// HTTP Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // API Routes
  if (pathname === '/api/status') {
    const volumeName = ipodPath ? ipodPath.split('/').pop() : null;
    const unmountedDevices = !ipodPath ? findUnmountedDevices() : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: !!ipodPath,
      path: ipodPath,
      volumeName: volumeName,
      ipodName: ipodName,
      ipodTrackCount: ipodTracks.length,
      localLibraryPath: LIBRARY_PATH,
      localTrackCount: getLocalTrackCount(),
      unmountedDevices: unmountedDevices
    }));
    return;
  }
  
  // Mount device endpoint
  if (pathname === '/api/mount' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { device } = JSON.parse(body);
        if (!device) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Device path required' }));
          return;
        }
        
        console.log(`🔌 Attempting to mount ${device}...`);
        const result = mountDevice(device);

        if (result.success) {
          if (result.alreadyMounted) {
            console.log(`ℹ️  Device already mounted at ${result.mountPoint}`);
          } else {
            console.log(`✅ Mounted successfully at ${result.mountPoint}`);
          }
          // Rescan for iPod
          setTimeout(() => {
            init();
          }, 1000);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            mountPoint: result.mountPoint,
            alreadyMounted: result.alreadyMounted || false
          }));
        } else {
          console.log(`❌ Mount failed: ${result.error}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: result.error }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  if (pathname === '/api/refresh') {
    init();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: !!ipodPath,
      path: ipodPath,
      ipodTrackCount: ipodTracks.length,
      localLibraryPath: LIBRARY_PATH,
      localTrackCount: getLocalTrackCount()
    }));
    return;
  }
  
  // Album art status - how many albums are missing art + fetch progress
  if (pathname === '/api/art/status') {
    const result = artStmts.countMissingArt.get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      missingCount: result?.count || 0,
      fetching: artFetchProgress.active,
      fetchProgress: artFetchProgress.current,
      fetchTotal: artFetchProgress.total,
      fetchFound: artFetchProgress.found
    }));
    return;
  }
  
  // Get album art for specific artist/album
  if (pathname === '/api/art/get') {
    const artist = url.searchParams.get('artist') || '';
    const album = url.searchParams.get('album') || '';
    
    const cached = artStmts.getArt.get(artist.toLowerCase(), album.toLowerCase());
    if (cached && cached.art_path && fs.existsSync(cached.art_path)) {
      // Serve the cached image
      const img = fs.readFileSync(cached.art_path);
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(img);
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Art not found' }));
    return;
  }
  
  // Fetch album art for albums missing it
  if (pathname === '/api/art/fetch' && req.method === 'POST') {
    // Don't start if already fetching
    if (artFetchProgress.active) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        started: false, 
        alreadyRunning: true,
        current: artFetchProgress.current,
        total: artFetchProgress.total
      }));
      return;
    }
    
    const missing = artStmts.getMissingArt.all();
    
    if (missing.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ fetched: 0, message: 'No missing album art' }));
      return;
    }
    
    // Filter out unknowns
    const toFetch = missing.filter(m => 
      m.artist && m.album && 
      m.artist !== 'Unknown Artist' && 
      m.album !== 'Unknown Album'
    );
    
    // Initialize progress
    artFetchProgress = {
      active: true,
      current: 0,
      total: toFetch.length,
      found: 0
    };
    
    // Start parallel fetching with concurrency limit
    const CONCURRENCY = 42;
    
    (async () => {
      console.log(`🎨 Starting parallel album art fetch (${CONCURRENCY} concurrent)...`);
      
      for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
        const batch = toFetch.slice(i, i + CONCURRENCY);
        
        const promises = batch.map(async ({ artist, album }) => {
          const currentNum = artFetchProgress.current + 1;
          artFetchProgress.current++;
          
          console.log(`🎨 [${currentNum}/${artFetchProgress.total}] Fetching: ${artist} - ${album}`);
          const artUrl = await fetchAlbumArt(artist, album);
          
          const id = `${artist.toLowerCase()}|||${album.toLowerCase()}`;
          const now = Date.now();
          
          if (artUrl) {
            const localPath = await downloadAlbumArt(artist, album, artUrl);
            if (localPath) {
              artStmts.upsertArt.run(id, artist.toLowerCase(), album.toLowerCase(), localPath, now, 0);
              artFetchProgress.found++;
              console.log(`  ✅ [${artist} - ${album}] Saved`);
              return true;
            } else {
              artStmts.upsertArt.run(id, artist.toLowerCase(), album.toLowerCase(), null, now, 1);
            }
          } else {
            artStmts.upsertArt.run(id, artist.toLowerCase(), album.toLowerCase(), null, now, 1);
            console.log(`  ❌ [${artist} - ${album}] Not found`);
          }
          return false;
        });
        
        // Wait for batch to complete
        await Promise.all(promises);
        
        // Small delay between batches
        if (i + CONCURRENCY < toFetch.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
      
      console.log(`🎨 Album art fetch complete: ${artFetchProgress.found} found out of ${artFetchProgress.total}`);
      artFetchProgress.active = false;
    })();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      started: true, 
      albumsToFetch: toFetch.length,
      message: `Fetching art for ${toFetch.length} albums...` 
    }));
    return;
  }
  
  // Serve cached album art images (with fallback to default)
  if (pathname.startsWith('/album-art/')) {
    const filename = pathname.replace('/album-art/', '');
    const filepath = path.join(artCacheDir, filename);
    
    // Check for cached art first
    if (fs.existsSync(filepath)) {
      const img = fs.readFileSync(filepath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(img);
      return;
    }
    
    // Fall back to default gray image (same as genre placeholder)
    const defaultPath = path.join(__dirname, 'default-genre.png');
    if (fs.existsSync(defaultPath)) {
      const img = fs.readFileSync(defaultPath);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(img);
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  // === GENRE ART API ===
  
  // Genre art status
  if (pathname === '/api/genre-art/status') {
    const result = stmts.countMissingGenreArt.get();
    const apiKeyRow = stmts.getSetting.get('openrouter_api_key');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      missingCount: result?.count || 0,
      hasApiKey: !!apiKeyRow?.value,
      generating: genreArtProgress.active,
      genProgress: genreArtProgress.current,
      genTotal: genreArtProgress.total,
      genGenerated: genreArtProgress.generated
    }));
    return;
  }
  
  // Save OpenRouter API key
  if (pathname === '/api/genre-art/set-key' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { apiKey } = JSON.parse(body);
        if (!apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'API key required' }));
          return;
        }
        
        stmts.setSetting.run('openrouter_api_key', apiKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Get genre art for specific genre
  if (pathname === '/api/genre-art/get') {
    const genre = url.searchParams.get('genre') || '';
    const cached = stmts.getGenreArt.get(genre.toLowerCase());
    
    if (cached && cached.art_path && fs.existsSync(cached.art_path)) {
      const img = fs.readFileSync(cached.art_path);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(img);
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Genre art not found' }));
    return;
  }
  
  // Generate genre art
  if (pathname === '/api/genre-art/generate' && req.method === 'POST') {
    // Check if already generating
    if (genreArtProgress.active) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        started: false,
        alreadyRunning: true,
        current: genreArtProgress.current,
        total: genreArtProgress.total
      }));
      return;
    }
    
    // Check for API key
    const apiKeyRow = stmts.getSetting.get('openrouter_api_key');
    if (!apiKeyRow?.value) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OpenRouter API key not set' }));
      return;
    }
    
    const apiKey = apiKeyRow.value;
    const missing = stmts.getMissingGenreArt.all();
    
    if (missing.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ generated: 0, message: 'All genres have art' }));
      return;
    }
    
    // Initialize progress
    genreArtProgress = {
      active: true,
      current: 0,
      total: missing.length,
      generated: 0
    };
    
    // Start parallel generation with concurrency limit
    const CONCURRENCY = 42; // Run 42 at a time
    
    (async () => {
      console.log(`🎨 Starting parallel genre art generation (${CONCURRENCY} concurrent)...`);
      
      // Process in batches
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const batch = missing.slice(i, i + CONCURRENCY);
        
        const promises = batch.map(async ({ genre }) => {
          const currentNum = genreArtProgress.current + 1;
          genreArtProgress.current++;
          
          console.log(`🎨 [${currentNum}/${genreArtProgress.total}] Generating genre art: ${genre}`);
          const imageData = await generateGenreArt(genre, apiKey);
          
          if (imageData) {
            const savedPath = await saveGenreArt(genre, imageData);
            if (savedPath) {
              stmts.upsertGenreArt.run(genre.toLowerCase(), savedPath, Date.now());
              genreArtProgress.generated++;
              console.log(`  ✅ [${genre}] Saved`);
              return true;
            } else {
              console.log(`  ❌ [${genre}] Failed to save`);
            }
          } else {
            console.log(`  ❌ [${genre}] Generation failed`);
          }
          return false;
        });
        
        // Wait for batch to complete
        await Promise.all(promises);
        
        // Small delay between batches to be nice to the API
        if (i + CONCURRENCY < missing.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      console.log(`🎨 Genre art generation complete: ${genreArtProgress.generated} generated out of ${genreArtProgress.total}`);
      genreArtProgress.active = false;
    })();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      started: true,
      genresToGenerate: missing.length,
      message: `Generating art for ${missing.length} genres...`
    }));
    return;
  }
  
  // Regenerate ALL genre art (clears existing and regenerates)
  if (pathname === '/api/genre-art/regenerate-all' && req.method === 'POST') {
    if (genreArtProgress.active) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: false, alreadyRunning: true }));
      return;
    }
    
    const apiKeyRow = stmts.getSetting.get('openrouter_api_key');
    if (!apiKeyRow?.value) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OpenRouter API key not set' }));
      return;
    }
    
    // Get ALL genres (not just missing)
    const allGenres = stmts.getAllGenres.all();
    // Add Unknown if there are tracks without genre
    const unknownCount = db.prepare("SELECT COUNT(*) as c FROM tracks WHERE genre IS NULL OR genre = ''").get();
    if (unknownCount.c > 0) {
      allGenres.push({ genre: 'Unknown' });
    }
    
    if (allGenres.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ generated: 0, message: 'No genres found' }));
      return;
    }
    
    // Clear existing genre art from DB
    db.prepare('DELETE FROM genre_art').run();
    
    const apiKey = apiKeyRow.value;
    genreArtProgress = {
      active: true,
      current: 0,
      total: allGenres.length,
      generated: 0
    };
    
    // Start parallel generation
    const CONCURRENCY = 42;
    (async () => {
      console.log(`🎨 Regenerating ALL genre art (${allGenres.length} genres, ${CONCURRENCY} concurrent)...`);
      
      for (let i = 0; i < allGenres.length; i += CONCURRENCY) {
        const batch = allGenres.slice(i, i + CONCURRENCY);
        
        const promises = batch.map(async ({ genre }) => {
          const currentNum = genreArtProgress.current + 1;
          genreArtProgress.current++;
          
          console.log(`🎨 [${currentNum}/${genreArtProgress.total}] Regenerating: ${genre}`);
          const imageData = await generateGenreArt(genre, apiKey);
          
          if (imageData) {
            const savedPath = await saveGenreArt(genre, imageData);
            if (savedPath) {
              stmts.upsertGenreArt.run(genre.toLowerCase(), savedPath, Date.now());
              genreArtProgress.generated++;
              console.log(`  ✅ [${genre}] Saved`);
              return true;
            }
          }
          console.log(`  ❌ [${genre}] Failed`);
          return false;
        });
        
        await Promise.all(promises);
        if (i + CONCURRENCY < allGenres.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      console.log(`🎨 Regeneration complete: ${genreArtProgress.generated}/${genreArtProgress.total}`);
      genreArtProgress.active = false;
    })();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      started: true,
      genresToGenerate: allGenres.length,
      message: `Regenerating all ${allGenres.length} genres...`
    }));
    return;
  }
  
  // Serve cached genre art images (with fallback to default)
  if (pathname.startsWith('/genre-art/')) {
    const filename = pathname.replace('/genre-art/', '');
    const filepath = path.join(genreArtDir, filename);
    
    // Check for generated art first
    if (fs.existsSync(filepath)) {
      const img = fs.readFileSync(filepath);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(img);
      return;
    }
    
    // Fall back to default gray image
    const defaultPath = path.join(__dirname, 'default-genre.png');
    if (fs.existsSync(defaultPath)) {
      const img = fs.readFileSync(defaultPath);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(img);
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  // === YOUTUBE MUSIC API ===
  
  // YTM status
  if (pathname === '/api/ytm/status') {
    const cookiesSet = !!stmts.getSetting.get('ytm_cookies_path')?.value;
    const trackCount = ytmStmts.countTracks.get().count;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: cookiesSet,
      trackCount,
      fetching: ytmFetchProgress.active,
      fetchProgress: ytmFetchProgress.current,
      fetchTotal: ytmFetchProgress.total,
      downloading: ytmDownloadProgress.active,
      downloadProgress: ytmDownloadProgress.current,
      downloadTotal: ytmDownloadProgress.total,
      downloadCompleted: ytmDownloadProgress.completed
    }));
    return;
  }
  
  // Upload YTM cookies file content
  if (pathname === '/api/ytm/upload-cookies' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cookies content required' }));
          return;
        }

        // Validate it looks like a Netscape cookies file
        if (!content.includes('youtube.com') && !content.includes('.youtube.com')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid cookies file - must contain YouTube cookies' }));
          return;
        }

        // Save to app directory
        const cookiesPath = path.join(__dirname, 'ytm-cookies.txt');
        fs.writeFileSync(cookiesPath, content);

        stmts.setSetting.run('ytm_cookies_path', cookiesPath);
        ytmCookiesPath = cookiesPath;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Set YTM cookies path (legacy)
  if (pathname === '/api/ytm/set-cookies' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { cookiesPath } = JSON.parse(body);
        if (!cookiesPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cookies path required' }));
          return;
        }

        // Validate file exists
        if (!fs.existsSync(cookiesPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cookies file not found' }));
          return;
        }

        stmts.setSetting.run('ytm_cookies_path', cookiesPath);
        ytmCookiesPath = cookiesPath;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Fetch YTM library (liked songs + playlists)
  if (pathname === '/api/ytm/fetch' && req.method === 'POST') {
    const cookiesPath = stmts.getSetting.get('ytm_cookies_path')?.value;
    if (!cookiesPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'YouTube Music cookies not configured' }));
      return;
    }
    
    if (ytmFetchProgress.active) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: false, alreadyRunning: true }));
      return;
    }
    
    ytmFetchProgress = { active: true, current: 0, total: 0 };
    
    // Start async fetch
    (async () => {
      try {
        console.log('🎵 Fetching YouTube Music library...');
        
        // Fetch liked songs
        const likedUrl = 'https://music.youtube.com/playlist?list=LM';
        console.log('🎵 Fetching liked songs...');
        
        const likedResult = execSync(
          `"${ytdlpPath}" --cookies "${cookiesPath}" --flat-playlist -j "${likedUrl}" 2>/dev/null`,
          { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
        ).toString();
        
        const likedTracks = likedResult.trim().split('\n').filter(Boolean).map(line => {
          try {
            return JSON.parse(line);
          } catch { return null; }
        }).filter(Boolean);
        
        console.log(`🎵 Found ${likedTracks.length} liked songs`);
        ytmFetchProgress.total = likedTracks.length;
        
        // Clear old data and insert new
        ytmStmts.deleteAll.run();
        
        for (const track of likedTracks) {
          ytmFetchProgress.current++;
          const id = `ytm_${track.id}`;
          ytmStmts.upsertTrack.run(
            id,
            track.id,
            track.title || 'Unknown',
            track.uploader || track.channel || 'Unknown Artist',
            track.album || null,
            track.duration || 0,
            track.thumbnail || track.thumbnails?.[0]?.url || null,
            'liked',
            'Liked Songs',
            Date.now()
          );
        }
        
        console.log(`🎵 YouTube Music fetch complete: ${likedTracks.length} tracks`);
        ytmFetchProgress.active = false;
        
      } catch (e) {
        console.error('🎵 YouTube Music fetch error:', e.message);
        ytmFetchProgress.active = false;
      }
    })();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ started: true }));
    return;
  }
  
  // Get YTM tracks
  if (pathname === '/api/ytm/tracks') {
    const tracks = ytmStmts.getAllTracks.all();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tracks }));
    return;
  }
  
  // Download YTM tracks to library
  if (pathname === '/api/ytm/download' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { trackIds, targetPath } = JSON.parse(body);
        const cookiesPath = stmts.getSetting.get('ytm_cookies_path')?.value;
        const libraryPath = targetPath || stmts.getSetting.get('library_path')?.value;
        
        if (!cookiesPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'YouTube Music cookies not configured' }));
          return;
        }
        
        if (!libraryPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Library path not configured' }));
          return;
        }
        
        if (!trackIds || !trackIds.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No tracks selected' }));
          return;
        }
        
        if (ytmDownloadProgress.active) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ started: false, alreadyRunning: true }));
          return;
        }
        
        ytmDownloadProgress = { active: true, current: 0, total: trackIds.length, completed: 0 };
        
        // Start async download
        (async () => {
          const downloadDir = path.join(libraryPath, 'YouTube Music');
          if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
          }
          
          for (const trackId of trackIds) {
            ytmDownloadProgress.current++;
            const track = ytmStmts.getTrack.get(trackId);
            if (!track) continue;
            
            console.log(`🎵 [${ytmDownloadProgress.current}/${ytmDownloadProgress.total}] Downloading: ${track.artist} - ${track.title}`);
            
            try {
              const videoUrl = `https://music.youtube.com/watch?v=${track.video_id}`;
              execSync(
                `"${ytdlpPath}" --cookies "${cookiesPath}" -x --audio-format mp3 --audio-quality 0 ` +
                `--embed-thumbnail --add-metadata ` +
                `-o "${downloadDir}/%(artist)s - %(title)s.%(ext)s" "${videoUrl}" 2>/dev/null`,
                { timeout: 300000 }
              );
              ytmDownloadProgress.completed++;
              console.log(`  ✅ Downloaded`);
            } catch (e) {
              console.log(`  ❌ Failed: ${e.message}`);
            }
          }
          
          console.log(`🎵 Download complete: ${ytmDownloadProgress.completed}/${ytmDownloadProgress.total}`);
          ytmDownloadProgress.active = false;
        })();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ started: true, count: trackIds.length }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Stream YTM track (proxy through yt-dlp)
  if (pathname.startsWith('/api/ytm/stream/')) {
    const videoId = pathname.split('/').pop();
    const cookiesPath = stmts.getSetting.get('ytm_cookies_path')?.value;
    
    if (!cookiesPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'YouTube Music cookies not configured' }));
      return;
    }
    
    try {
      // Get audio URL
      const videoUrl = `https://music.youtube.com/watch?v=${videoId}`;
      const audioUrl = execSync(
        `"${ytdlpPath}" --cookies "${cookiesPath}" -f bestaudio -g "${videoUrl}" 2>/dev/null`,
        { timeout: 30000 }
      ).toString().trim();
      
      // Redirect to the actual audio URL
      res.writeHead(302, { 'Location': audioUrl });
      res.end();
    } catch (e) {
      console.error('YTM stream error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get stream URL' }));
    }
    return;
  }
  
  // === LOCAL LIBRARY API ===

  // Get local library tracks (from database - instant!)
  if (pathname === '/api/library/tracks') {
    const total = getLocalTrackCount();
    const limit = parseInt(url.searchParams.get('limit')) || total;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    
    // Query database directly - metadata is already indexed
    const tracks = db.prepare(`
      SELECT * FROM tracks WHERE source = 'local' 
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total,
      offset,
      limit,
      tracks: tracks.map(t => ({
        id: t.id,
        path: t.path,
        size: t.size,
        source: 'local',
        title: t.title,
        artist: t.artist,
        album: t.album,
        genre: t.genre,
        track: t.track,
        year: t.year,
        duration: t.duration
      }))
    }));
    return;
  }
  
  // === PLAYLIST API ===

  // POST /api/playlists - Create playlist
  if (pathname === '/api/playlists' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, source } = JSON.parse(body);
        if (!name || !source) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Name and source required' }));
          return;
        }

        const id = Date.now().toString();
        const now = Date.now();

        playlistStmts.createPlaylist.run(id, name, source, now, now);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id, name, source }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/playlists?source=library
  if (pathname === '/api/playlists' && req.method === 'GET') {
    const source = url.searchParams.get('source') || 'library';
    const playlists = playlistStmts.getPlaylistsBySource.all(source);

    // Add track counts
    const playlistsWithCounts = playlists.map(p => ({
      ...p,
      trackCount: playlistStmts.getPlaylistTracks.all(p.id).length
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ playlists: playlistsWithCounts }));
    return;
  }

  // DELETE /api/playlists/:id
  if (pathname.startsWith('/api/playlists/') && req.method === 'DELETE' && !pathname.includes('/tracks')) {
    const id = pathname.split('/')[3];
    playlistStmts.deletePlaylist.run(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // PUT /api/playlists/:id - Rename
  if (pathname.startsWith('/api/playlists/') && req.method === 'PUT') {
    const id = pathname.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        playlistStmts.renamePlaylist.run(name, Date.now(), id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, name }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/playlists/:id/tracks
  if (pathname.match(/^\/api\/playlists\/[^/]+\/tracks$/) && req.method === 'GET') {
    const id = pathname.split('/')[3];
    const playlist = playlistStmts.getPlaylist.get(id);

    if (!playlist) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Playlist not found' }));
      return;
    }

    const playlistTracks = playlistStmts.getPlaylistTracks.all(id);

    // Join with appropriate tracks table based on source
    const tracksTable = playlist.source === 'ytm' ? 'ytm_tracks' : 'tracks';
    const tracks = playlistTracks.map(pt => {
      const track = db.prepare(`SELECT * FROM ${tracksTable} WHERE id = ?`).get(pt.track_id);
      if (track) {
        return { ...track, playlistPosition: pt.position };
      }
      return null;
    }).filter(t => t !== null); // Filter out deleted tracks

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tracks }));
    return;
  }

  // POST /api/playlists/:id/tracks - Add tracks
  if (pathname.match(/^\/api\/playlists\/[^/]+\/tracks$/) && req.method === 'POST') {
    const playlistId = pathname.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { trackIds } = JSON.parse(body);

        // Get max position
        const maxPosResult = playlistStmts.getMaxPosition.get(playlistId);
        const maxPos = maxPosResult?.max || 0;

        trackIds.forEach((trackId, idx) => {
          const id = `${Date.now()}-${idx}`;
          playlistStmts.addTrackToPlaylist.run(id, playlistId, trackId, maxPos + idx + 1, Date.now());
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, added: trackIds.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /api/playlists/:id/tracks/:trackId
  if (pathname.match(/^\/api\/playlists\/[^/]+\/tracks\/[^/]+$/) && req.method === 'DELETE') {
    const parts = pathname.split('/');
    const playlistId = parts[3];
    const trackId = parts[5];

    playlistStmts.removeTrackFromPlaylist.run(playlistId, trackId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Check for duplicates between sources
  if (pathname === '/api/duplicates') {
    const source = url.searchParams.get('source') || 'ipod'; // which source to check FROM
    const trackIds = url.searchParams.get('ids')?.split(',') || [];
    
    const sourceTracks = source === 'ipod' ? ipodTracks : getLocalTracks();
    const destTracks = source === 'ipod' ? getLocalTracks() : ipodTracks;
    
    // Build a set of fingerprints from destination (local tracks already have metadata in db)
    const destFingerprints = new Set();
    for (const track of destTracks) {
      let meta;
      if (track.title) {
        // Already has metadata (from db)
        meta = track;
      } else if (track.metadata) {
        meta = track.metadata;
      } else {
        meta = getMetadata(track.fullPath || track.full_path);
      }
      // Fingerprint: lowercase title + artist + album
      const fp = `${(meta.title || '').toLowerCase().trim()}|||${(meta.artist || '').toLowerCase().trim()}|||${(meta.album || '').toLowerCase().trim()}`;
      destFingerprints.add(fp);
    }
    
    // Check which source tracks already exist in destination
    const results = { duplicates: [], unique: [] };
    
    for (const trackId of trackIds) {
      const track = sourceTracks.find(t => t.id === trackId);
      if (!track) continue;
      
      let meta;
      if (track.title) {
        meta = track;
      } else if (track.metadata) {
        meta = track.metadata;
      } else {
        meta = getMetadata(track.fullPath || track.full_path);
        track.metadata = meta;
      }
      const fp = `${(meta.title || '').toLowerCase().trim()}|||${(meta.artist || '').toLowerCase().trim()}|||${(meta.album || '').toLowerCase().trim()}`;
      
      if (destFingerprints.has(fp)) {
        results.duplicates.push({ id: trackId, title: meta.title, artist: meta.artist });
      } else {
        results.unique.push({ id: trackId, title: meta.title, artist: meta.artist });
      }
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
    return;
  }

  // Sync tracks from iPod to computer
  if (pathname === '/api/sync/to-library' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { trackIds } = JSON.parse(body);
        const results = { success: [], failed: [] };

        for (const trackId of trackIds) {
          const track = ipodTracks.find(t => t.id === trackId);
          if (!track) {
            results.failed.push({ id: trackId, error: 'Track not found' });
            continue;
          }

          try {
            // Get metadata for folder structure
            if (!track.metadata) {
              track.metadata = getMetadata(track.fullPath);
            }
            const meta = track.metadata;

            // Create Artist/Album folder structure in library path
            const artistFolder = (meta.artist || 'Unknown Artist').replace(/[<>:"/\\|?*]/g, '_');
            const albumFolder = (meta.album || 'Unknown Album').replace(/[<>:"/\\|?*]/g, '_');
            const targetDir = path.join(LIBRARY_PATH, artistFolder, albumFolder);

            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            // Build filename from metadata
            const ext = path.extname(track.fullPath);
            const title = (meta.title || 'Unknown').replace(/[<>:"/\\|?*]/g, '_');
            const trackNum = meta.track ? meta.track.split('/')[0].padStart(2, '0') + ' - ' : '';
            const destFilename = `${trackNum}${title}${ext}`;
            const destPath = path.join(targetDir, destFilename);

            // Check if file already exists
            if (fs.existsSync(destPath)) {
              results.failed.push({ id: trackId, error: 'File already exists' });
              continue;
            }

            fs.copyFileSync(track.fullPath, destPath);
            results.success.push({
              id: trackId,
              destPath: path.relative(LIBRARY_PATH, destPath),
              title: meta.title,
              artist: meta.artist
            });

          } catch (e) {
            results.failed.push({ id: trackId, error: e.message });
          }
        }

        // Rescan local library after sync to update database
        if (results.success.length > 0) {
          scanLocalLibrary(LIBRARY_PATH);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Sync tracks to iPod
  if (pathname === '/api/sync' && req.method === 'POST') {
    if (!ipodPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No iPod connected' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { trackIds } = JSON.parse(body);
        const results = { success: [], failed: [] };
        
        for (const trackId of trackIds) {
          const track = stmts.getTrack.get(trackId);
          if (!track) {
            results.failed.push({ id: trackId, error: 'Track not found' });
            continue;
          }
          
          try {
            // Generate iPod-style filename
            const ext = path.extname(track.full_path);
            const randomName = Math.random().toString(36).substring(2, 6).toUpperCase();
            
            // Find a folder with space (F00-F49)
            const musicPath = path.join(ipodPath, 'iPod_Control', 'Music');
            let targetFolder = null;
            for (let i = 0; i < 50; i++) {
              const folder = path.join(musicPath, `F${i.toString().padStart(2, '0')}`);
              if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
              }
              const files = fs.readdirSync(folder);
              if (files.length < 100) {
                targetFolder = folder;
                break;
              }
            }
            
            if (!targetFolder) {
              results.failed.push({ id: trackId, error: 'iPod full' });
              continue;
            }
            
            const destPath = path.join(targetFolder, randomName + ext);
            fs.copyFileSync(track.full_path, destPath);
            results.success.push({ id: trackId, destPath: path.relative(ipodPath, destPath) });
            
          } catch (e) {
            results.failed.push({ id: trackId, error: e.message });
          }
        }
        
        // Rescan iPod after sync
        ipodTracks = scanIPod(ipodPath);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  if (pathname === '/api/eject') {
    if (!ipodPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No device connected' }));
      return;
    }
    
    try {
      // Get the block device for this mount
      let blockDevice = null;
      try {
        blockDevice = execSync(`findmnt -n -o SOURCE "${ipodPath}"`, { encoding: 'utf8', timeout: 5000 }).trim();
      } catch (e) {
        // Mount point might not exist anymore
      }
      
      if (blockDevice) {
        // Get the base device (without partition number) for power-off
        const baseDevice = blockDevice.replace(/[0-9]+$/, '');
        
        try {
          // Unmount using udisksctl (works without root)
          execSync(`udisksctl unmount -b "${blockDevice}"`, { timeout: 10000, encoding: 'utf8' });
          console.log(`Unmounted ${blockDevice}`);
        } catch (e) {
          console.log('Unmount error (may already be unmounted):', e.message);
        }
        
        try {
          // Power off the device (safe removal)
          execSync(`udisksctl power-off -b "${baseDevice}"`, { timeout: 10000, encoding: 'utf8' });
          console.log(`Powered off ${baseDevice}`);
        } catch (e) {
          console.log('Power-off error:', e.message);
        }
      }
      
      // Clear state regardless
      const ejectedPath = ipodPath;
      ipodPath = null;
      tracks = [];
      metadataCache.clear();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ejectedPath }));
    } catch (e) {
      console.error('Eject error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }
  
  if (pathname === '/api/tracks') {
    // Return iPod tracks with metadata (lazy load)
    const withMeta = url.searchParams.get('meta') === '1';
    const limit = parseInt(url.searchParams.get('limit')) || ipodTracks.length;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    
    const slice = ipodTracks.slice(offset, offset + limit);
    
    if (withMeta) {
      for (const track of slice) {
        if (!track.metadata) {
          if (metadataCache.has(track.id)) {
            track.metadata = metadataCache.get(track.id);
          } else {
            track.metadata = getMetadata(track.fullPath);
            metadataCache.set(track.id, track.metadata);
          }
        }
      }
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: ipodTracks.length,
      offset,
      limit,
      tracks: slice.map(t => ({
        id: t.id,
        path: t.path,
        size: t.size,
        source: 'ipod',
        ...(t.metadata || {})
      }))
    }));
    return;
  }
  
  // Batch metadata endpoint - load in chunks
  if (pathname === '/api/metadata') {
    const ids = url.searchParams.get('ids')?.split(',') || [];
    const source = url.searchParams.get('source') || 'ipod';
    const results = {};
    
    for (const id of ids.slice(0, 50)) { // Max 50 at a time
      // Check database first (local tracks already indexed)
      const dbTrack = stmts.getTrack.get(id);
      if (dbTrack) {
        results[id] = {
          title: dbTrack.title,
          artist: dbTrack.artist,
          album: dbTrack.album,
          genre: dbTrack.genre,
          track: dbTrack.track,
          year: dbTrack.year,
          duration: dbTrack.duration
        };
        continue;
      }
      
      // Fallback to ipod tracks
      const track = ipodTracks.find(t => t.id === id);
      if (track) {
        if (!metadataCache.has(id)) {
          metadataCache.set(id, getMetadata(track.fullPath));
        }
        results[id] = metadataCache.get(id);
      }
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
    return;
  }
  
  if (pathname.startsWith('/api/track/')) {
    const id = pathname.split('/')[3];
    const track = tracks.find(t => t.id === id);
    
    if (!track) {
      res.writeHead(404);
      res.end('Track not found');
      return;
    }
    
    if (!track.metadata) {
      track.metadata = getMetadata(track.fullPath);
      metadataCache.set(track.id, track.metadata);
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: track.id,
      path: track.path,
      size: track.size,
      ...track.metadata
    }));
    return;
  }
  
  // Album art extraction
  if (pathname.startsWith('/art/')) {
    const id = pathname.split('/')[2];
    let track = ipodTracks.find(t => t.id === id);
    let trackPath = track?.fullPath;
    
    if (!track) {
      const dbTrack = stmts.getTrack.get(id);
      if (dbTrack) trackPath = dbTrack.full_path;
    }
    
    if (!trackPath || !fs.existsSync(trackPath)) {
      res.writeHead(404);
      res.end('Track not found');
      return;
    }
    
    try {
      // Extract album art using ffmpeg
      const artData = execSync(
        `ffmpeg -i "${trackPath}" -an -vcodec copy -f mjpeg pipe:1 2>/dev/null`,
        { maxBuffer: 5 * 1024 * 1024, timeout: 5000 }
      );
      
      res.writeHead(200, { 
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(artData);
    } catch (e) {
      // No art or extraction failed - return default placeholder
      const defaultPath = path.join(__dirname, 'default-genre.png');
      if (fs.existsSync(defaultPath)) {
        const img = fs.readFileSync(defaultPath);
        res.writeHead(200, { 
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(img);
      } else {
        res.writeHead(404);
        res.end('No artwork');
      }
    }
    return;
  }

  if (pathname.startsWith('/audio/')) {
    const id = pathname.split('/')[2];
    let track = ipodTracks.find(t => t.id === id);
    let trackPath = track?.fullPath;
    let trackSize = track?.size;
    
    if (!track) {
      const dbTrack = stmts.getTrack.get(id);
      if (dbTrack) {
        trackPath = dbTrack.full_path;
        trackSize = dbTrack.size;
      }
    }
    
    if (!trackPath || !fs.existsSync(trackPath)) {
      res.writeHead(404);
      res.end('Track not found');
      return;
    }
    
    const stat = fs.statSync(trackPath);
    const ext = path.extname(trackPath).toLowerCase();
    const mime = mimeTypes[ext] || 'application/octet-stream';
    
    // Support range requests for seeking
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mime
      });
      
      fs.createReadStream(trackPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(trackPath).pipe(res);
    }
    return;
  }
  
  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);
  
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeTypes[ext] || 'text/plain';
  
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

init();

server.listen(PORT, () => {
  console.log(`\n🦞 yTunes running at http://localhost:${PORT}\n`);
});
