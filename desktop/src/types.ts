export type DownloadPayload = {
  kind: 'download'
  url: string
  ffmpeg_download: boolean
  auto_clear_temp_files: boolean
  target_file_name: string
  folder: string
  concurrent: number
  download_dir: string
  headers: Record<string, string>
  combine_retry_count: number
}

export type CombinePayload = {
  kind: 'combine'
  inputs: string[]
  reg_name: string
  reg_name_start: number
  reg_name_end: number
  target_file_name: string
  same_param_index: number
  set_fps: number
  set_a_b: number
  set_v_b: number
  set_height: number
  set_width: number
}

export type CutPayload = {
  kind: 'cut'
  input: string
  start: number
  duration: number
  target_file_name: string
  delete_input_file: boolean
}

export type CutSegment = {
  start: number
  duration: number
  target_file_name: string
}

export type CutBatchPayload = {
  kind: 'cut_batch'
  input: string
  delete_input_file: boolean
  segments: CutSegment[]
}

export type TranscodePayload = {
  kind: 'transcode'
  input: string
  target_file_name: string
  video_codec: string
  resolution: string
  video_bitrate_kbps: number
  fps: number
  audio_codec: string
  audio_bitrate_kbps: number
  audio_channels: number
  audio_sample_rate: number
}

export type TaskPayload = DownloadPayload | CombinePayload | CutPayload | CutBatchPayload | TranscodePayload
export type TaskKind = TaskPayload['kind']

export type TaskStatus = 'queued' | 'running' | 'success' | 'failed'

export type TaskRecord = {
  id: number
  title: string
  status: TaskStatus
  created_at: number
  started_at: number | null
  finished_at: number | null
  command_preview: string
  message: string | null
  result_path: string | null
  parent_id: number | null
  child_task_ids: number[]
  payload: TaskPayload
}

export type CreateTaskRequest = {
  title?: string
  payload: TaskPayload
}

export type TaskDetail = {
  task: TaskRecord
  output_dir: string | null
  output_files: string[]
  base_info: BaseInfo | null
  child_tasks: TaskRecord[]
}

export type HeaderPreset = {
  host: string
  headers: Record<string, string>
}

export type BaseInfo = {
  url: string
  m3u8_name: string
  header: Record<string, string>
  target_file_name: string
  folder: string
  concurrent: number
  download_dir: string
  ffmpeg_download: boolean
  auto_clear_temp_files: boolean
  combine_retry_count: number
}

export type HeaderRow = {
  key: string
  value: string
}

export type VideoProbeInfo = {
  format_name: string
  duration_seconds: number | null
  size_bytes: number | null
  overall_bitrate: number | null
  video_codec: string | null
  width: number | null
  height: number | null
  fps: number | null
  video_bitrate: number | null
  audio_codec: string | null
  audio_channels: number | null
  audio_sample_rate: number | null
  audio_bitrate: number | null
}

export type TranscodePreset = {
  title: string
  video_codec: string
  resolution: string
  video_bitrate_kbps: number
  fps: number
  audio_codec: string
  audio_bitrate_kbps: number
  audio_channels: number
  audio_sample_rate: number
}
