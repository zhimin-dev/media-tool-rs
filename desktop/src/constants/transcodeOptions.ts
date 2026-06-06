export type SelectOption = {
  value: string
  label: string
}

export const VIDEO_CODEC_OPTIONS: SelectOption[] = [
  { value: '', label: '跟随原视频' },
  { value: 'h264', label: 'H.264 (libx264)' },
  { value: 'h265', label: 'H.265 (libx265)' },
  { value: 'copy', label: '拷贝不转码' },
]

export const RESOLUTION_OPTIONS: SelectOption[] = [
  { value: '', label: '跟随原视频' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
  { value: '1920x1080', label: '1920x1080' },
]