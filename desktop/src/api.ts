import type {
  CreateHeaderPresetRequest,
  CreateTaskRequest,
  HeaderPreset,
  TaskRecord,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || '请求失败')
  }

  return (await response.json()) as T
}

export async function fetchTasks(): Promise<TaskRecord[]> {
  const response = await fetch(`${API_BASE}/tasks`)
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

export async function fetchHeaderPresets(): Promise<HeaderPreset[]> {
  const response = await fetch(`${API_BASE}/header-presets`)
  return parseResponse<HeaderPreset[]>(response)
}

export async function createHeaderPreset(
  request: CreateHeaderPresetRequest,
): Promise<HeaderPreset> {
  const response = await fetch(`${API_BASE}/header-presets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  return parseResponse<HeaderPreset>(response)
}
