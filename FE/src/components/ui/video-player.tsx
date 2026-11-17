"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { formatDuration } from "@/lib/format";

const SPEEDS = [0.5, 1, 1.5, 2, 4] as const;

/** Native <video> with template-styled controls: play, seek, ±10s, speed, mute, fullscreen, download. */
export function VideoPlayer({ src, title, poster, autoPlay = false, downloadName }: { src: string | null | undefined; title: string; poster?: string; autoPlay?: boolean; downloadName?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {
        // Autoplay / decode refused by the browser: keep the paused state.
        setPlaying(false);
      });
    } else v.pause();
  };
  const seekBy = (d: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
  };
  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Already left fullscreen (Escape): nothing to do.
      });
    } else {
      el.requestFullscreen().catch(() => {
        // Fullscreen not allowed in this context (iframe / iOS): stay inline.
      });
    }
  };

  if (!src || failed) {
    return (
      <div className="tv-player" aria-label={title}>
        <div className="tv-player-empty">
          <div>
            <Icon name="film" />
            <p>{failed ? "This video could not be played." : "No video available."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-player" ref={wrapRef}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        preload="metadata"
        aria-label={title}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
      <div className="tv-player-controls">
        <button type="button" onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
          <Icon name="rewind" />
        </button>
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button type="button" onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
          <Icon name="fast-forward" />
        </button>
        <span className="tv-player-time">
          {formatDuration(time)} / {formatDuration(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          aria-label="Seek"
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.currentTarget.value);
          }}
        />
        <select value={speed} aria-label="Playback speed" onChange={(e) => setSpeed(Number(e.currentTarget.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
          <Icon name={muted ? "speaker-x" : "speaker"} />
        </button>
        {downloadName ? (
          <a href={src} download={downloadName} aria-label="Download video" className="icon-button" style={{ color: "#fff", width: 32, height: 32 }}>
            <Icon name="download" />
          </a>
        ) : null}
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
          <Icon name={fullscreen ? "arrows-in" : "arrows-out"} />
        </button>
      </div>
    </div>
  );
}
