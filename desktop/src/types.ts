export type DownloadPayload = {
  kind: 'download'
  url: string
  ffmpeg_download: boolean
  target_file_name: string
  folder: string
  concurrent: number
  download_dir: string
  headers: Record<string, string>
}

export type CombinePayload = {
  kind: 'combine'
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
}

export type TaskPayload = DownloadPayload | CombinePayload | CutPayload

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
}

export type HeaderPreset = {
  host: string
  headers: Record<string, string>
}
