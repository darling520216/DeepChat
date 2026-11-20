import { memo } from 'react'
import type { SongPart } from '../../services/chat/types.js'
import { IconMusicNote16 } from '../base/icons.js'
import styles from './SongCard.module.css'

/** 唱歌通道生成的翻唱歌曲卡：标题信息 + 内嵌播放器 */
export const SongCard = memo(function SongCard({ song }: { song: SongPart }) {
  const label = [song.title, song.artist].filter(Boolean).join(' — ') || song.song
  return (
    <div className={styles.songCard}>
      <div className={styles.titleRow}>
        <IconMusicNote16 />
        <span>{label}</span>
        {song.cached ? <span className={styles.badge}>cache</span> : null}
      </div>
      <div className={styles.meta}>
        <span>{song.song}</span>
        {song.durationSeconds > 0 ? <span>{song.durationSeconds}s</span> : null}
        {song.voice ? <span>{song.voice}</span> : null}
      </div>
      {/* audio_url 为网关公开缓存直链；媒体元素跨源加载不受 CORS 限制 */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 纯音乐播放器，无字幕轨道 */}
      <audio className={styles.audio} controls preload="none" src={song.audioUrl} />
    </div>
  )
})
