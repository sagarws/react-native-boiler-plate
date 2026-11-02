/**
 * YouTube high-quality video downloader (Node CLI script, not part of the app bundle).
 *
 * Why yt-dlp instead of raw API calls:
 *   The captured network record (api-network-records.json) shows that `/youtubei/v1/player`
 *   returns direct URLs only for itag 18 (360p). Every HD/4K format (137, 248, 271, 313, 399,
 *   401 …) has no `url` — it is served only through SABR (`serverAbrStreamingUrl`, protobuf
 *   POSTs to googlevideo.com/videoplayback?sabr=1) and needs PO tokens + n-sig deciphering
 *   that change with every player release. yt-dlp maintains all of that, so we drive it here
 *   and use ffmpeg to merge the separate best video + best audio streams.
 *
 * Requirements:
 *   - yt-dlp  →  `pip install -U "yt-dlp[default]"`  (includes the EJS challenge solver)
 *   - Node    →  used by yt-dlp as the JS runtime for YouTube's player challenges
 *   - ffmpeg  →  already on PATH (needed to merge video + audio)
 *
 * Usage:
 *   node youtubeVideoDownload.js                      # downloads VIDEO_URL below
 *   node youtubeVideoDownload.js <youtube-url>        # overrides VIDEO_URL
 *   node youtubeVideoDownload.js <youtube-url> 1080   # overrides MAX_HEIGHT
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Change these ────────────────────────────────────────────────────────────
const VIDEO_URL = 'https://www.youtube.com/watch?v=X7pNbK8ATiE';
const OUTPUT_DIR = path.join(__dirname, 'downloads');
const MAX_HEIGHT = 2160; // 2160 = 4K, 1440, 1080, 720 …
const PREFER_MP4 = true; // true → H.264/AAC .mp4 (plays everywhere); false → best codec (VP9/AV1, .mkv/.webm)
// ─────────────────────────────────────────────────────────────────────────────

const YOUTUBE_ID_RE = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/;

/** Extracts the 11-char video id; throws on anything that isn't a YouTube video URL. */
function getVideoId(url) {
  const match = String(url).match(YOUTUBE_ID_RE);
  if (!match) {
    throw new Error(`Not a valid YouTube video URL: ${url}`);
  }
  return match[1];
}

/** Finds a working yt-dlp command: the standalone binary, or the Python module. */
function resolveYtDlp() {
  const candidates = [
    ['yt-dlp', []],
    ['python', ['-m', 'yt_dlp']],
    ['py', ['-m', 'yt_dlp']],
  ];
  for (const [cmd, prefix] of candidates) {
    const probe = spawnSync(cmd, [...prefix, '--version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return { cmd, prefix, version: probe.stdout.trim() };
    }
  }
  throw new Error('yt-dlp not found. Install it with:  pip install -U "yt-dlp[default]"');
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version']).status === 0;
}

/**
 * yt-dlp format selector (-f) + sort order (-S): best video ≤ maxHeight + best audio.
 * Resolution always wins; with preferMp4, ties go to MP4-container streams. Note YouTube
 * has H.264 only up to 1080p, so 1440p/4K in MP4 comes out as AV1.
 */
function buildFormat(maxHeight, preferMp4) {
  const h = `[height<=${maxHeight}]`;
  return {
    format: `bv*${h}+ba/b${h}/b`,
    sort: preferMp4 ? `res:${maxHeight},ext:mp4:m4a` : `res:${maxHeight}`,
  };
}

/**
 * Downloads a YouTube video in the highest quality available up to `maxHeight`.
 * @returns {Promise<string>} absolute path of the downloaded file
 */
async function downloadYoutubeVideo(url, options = {}) {
  const {
    outputDir = OUTPUT_DIR,
    maxHeight = MAX_HEIGHT,
    preferMp4 = PREFER_MP4,
  } = options;

  const videoId = getVideoId(url);
  const ytdlp = resolveYtDlp();
  if (!hasFfmpeg()) {
    throw new Error('ffmpeg not found on PATH — it is required to merge HD video and audio.');
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const { format, sort } = buildFormat(maxHeight, preferMp4);
  const args = [
    ...ytdlp.prefix,
    '-f', format,
    '-S', sort,
    '--merge-output-format', preferMp4 ? 'mp4' : 'mkv',
    '-o', path.join(outputDir, '%(title).150B [%(id)s] %(height)sp.%(ext)s'),
    // YouTube's n/sig challenges need a JS runtime; reuse the Node that runs this script.
    '--js-runtimes', `node:${process.execPath}`,
    '--no-playlist',
    '--restrict-filenames',
    '--newline',
    '--print', 'after_move:filepath',
    '--no-simulate',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  console.log(`yt-dlp ${ytdlp.version} — downloading ${videoId} (≤${maxHeight}p) to ${outputDir}`);

  return new Promise((resolve, reject) => {
    const child = spawn(ytdlp.cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let lastLine = '';
    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      const lines = text.trim().split(/\r?\n/);
      lastLine = lines[lines.length - 1] || lastLine;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(lastLine.trim());
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });
}

module.exports = { downloadYoutubeVideo, getVideoId, buildFormat };

if (require.main === module) {
  const url = process.argv[2] || VIDEO_URL;
  const maxHeight = Number(process.argv[3]) || MAX_HEIGHT;
  downloadYoutubeVideo(url, { maxHeight })
    .then(file => console.log(`\n✔ Saved: ${file}`))
    .catch(err => {
      console.error(`\n✘ ${err.message}`);
      process.exit(1);
    });
}
