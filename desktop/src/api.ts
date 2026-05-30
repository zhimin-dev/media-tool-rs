import type { BaseInfo, CreateTaskRequest, HeaderPreset, TaskDetail, TaskKind, TaskRecord } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || '请求失败')
  }

  return (await response.json()) as T
}

export async function fetchTasks(kind?: TaskKind): Promise<TaskRecord[]> {
  const search = kind ? `?kind=${encodeURIComponent(kind)}` : ''
  const response = await fetch(`${API_BASE}/tasks${search}`)
  return parseResponse<TaskRecord[]>(response)
}

export async function createTask(request: CreateTaskRequest): Promise<TaskRecord> {
  const response = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  return parseResponse<TaskRecord>(response)
}

type UploadVideoOptions = {
  subDir?: string
}

export async function uploadVideo(file: File, options: UploadVideoOptions = {}): Promise<{ path: string }> {
  const params = new URLSearchParams({ file_name: file.name || 'uploaded.mp4' })
  if (options.subDir?.trim()) {
    params.set('sub_dir', options.subDir.trim())
  }
  const response = await fetch(`${API_BASE}/upload-video?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })
  return parseResponse<{ path: string }>(response)
}

export async function retryTask(id: number): Promise<TaskRecord> {
  const response = await fetch(`${API_BASE}/tasks/${id}/retry`, {
    method: 'POST',
  })
  return parseResponse<TaskRecord>(response)
}

export async function deleteTask(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'DELETE',
  })
  await parseResponse<TaskRecord>(response)
}

export async function fetchTaskDetail(id: number): Promise<TaskDetail> {
  const response = await fetch(`${API_BASE}/tasks/${id}/detail`)
  return parseResponse<TaskDetail>(response)
}

export async function updateTaskBaseInfo(id: number, payload: BaseInfo): Promise<TaskRecord> {
  const response = await fetch(`${API_BASE}/tasks/${id}/base-info`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse<TaskRecord>(response)
}

export async function fetchHeaderPresets(): Promise<HeaderPreset[]> {
  const response = await fetch(`${API_BASE}/header-presets`)
  return parseResponse<HeaderPreset[]>(response)
}

export async function saveHeaderPreset(request: HeaderPreset): Promise<HeaderPreset> {
  const response = await fetch(`${API_BASE}/header-presets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  return parseResponse<HeaderPreset>(response)
}

export async function deleteHeaderPreset(host: string): Promise<void> {
  const response = await fetch(`${API_BASE}/header-presets/${encodeURIComponent(host)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || '删除预设失败')
  }
}
