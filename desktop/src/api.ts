import type {
  BaseInfo,
  CreateTaskRequest,
  CutSegment,
  HeaderPreset,
  TaskDetail,
  TaskKind,
  TaskRecord,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

let cachedApiBase: string | null = null

function inTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function resolveApiBase(): Promise<string> {
  if (!inTauriRuntime()) {
    return API_BASE
  }

  const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  try {
    const tauriCore = await import('@tauri-apps/api/core')
    for (let retry = 0; retry < 40; retry += 1) {
      try {
        const base = await tauriCore.invoke<string>('api_base')
        if (base?.trim()) {
          return base
        }
      } catch {
        // The embedded server may still be booting on first app launch.
      }
      await wait(150)
    }
    return API_BASE
  } catch {
    return API_BASE
  }
}

async function getApiBase(): Promise<string> {
  if (!inTauriRuntime()) {
    return API_BASE
  }

  if (cachedApiBase) {
    return cachedApiBase
  }

  const resolved = await resolveApiBase()
  if (resolved !== API_BASE) {
    cachedApiBase = resolved
  }
  return resolved
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await getApiBase()
  try {
    return await fetch(`${base}${path}`, init)
  } catch (error) {
    if (!inTauriRuntime()) {
      throw error
    }

    cachedApiBase = null
    const refreshedBase = await getApiBase()
    return fetch(`${refreshedBase}${path}`, init)
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || '请求失败')
  }

  return (await response.json()) as T
}

export type ApiConnectionStatus = {
  apiBase: string
  healthy: boolean
  message: string
}

export async function getApiConnectionStatus(): Promise<ApiConnectionStatus> {
  const apiBase = await getApiBase()
  try {
    const response = await fetch(`${apiBase}/health`)
    if (!response.ok) {
      return {
        apiBase,
        healthy: false,
        message: `health check failed (${response.status})`,
      }
    }
    return {
      apiBase,
      healthy: true,
      message: 'ok',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'health check request failed'
    return {
      apiBase,
      healthy: false,
      message,
    }
  }
}

export async function getAppVersion(): Promise<string> {
  if (!inTauriRuntime()) {
    return import.meta.env.VITE_APP_VERSION ?? 'dev'
  }

  try {
    const tauriCore = await import('@tauri-apps/api/core')
    const version = await tauriCore.invoke<string>('app_version')
    return version || 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function fetchTasks(kind?: TaskKind): Promise<TaskRecord[]> {
  const search = kind ? `?kind=${encodeURIComponent(kind)}` : ''
  const response = await apiFetch(`/tasks${search}`)
  return parseResponse<TaskRecord[]>(response)
}

export async function createTask(request: CreateTaskRequest): Promise<TaskRecord> {
  const response = await apiFetch('/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  return parseResponse<TaskRecord>(response)
}

type CreateCutBatchRequest = {
  title?: string
  input: string
  delete_input_file?: boolean
  segments: CutSegment[]
}

export async function createCutBatch(request: CreateCutBatchRequest): Promise<TaskRecord> {
  const response = await apiFetch('/tasks/cut-batch', {
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
  const response = await apiFetch(`/upload-video?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })
  return parseResponse<{ path: string }>(response)
}

export async function retryTask(id: number): Promise<TaskRecord> {
  const response = await apiFetch(`/tasks/${id}/retry`, {
    method: 'POST',
  })
  return parseResponse<TaskRecord>(response)
}

export async function deleteTask(id: number): Promise<void> {
  const response = await apiFetch(`/tasks/${id}`, {
    method: 'DELETE',
  })
  await parseResponse<TaskRecord>(response)
}

export async function fetchTaskDetail(id: number): Promise<TaskDetail> {
  const response = await apiFetch(`/tasks/${id}/detail`)
  return parseResponse<TaskDetail>(response)
}

export async function updateTaskBaseInfo(id: number, payload: BaseInfo): Promise<TaskRecord> {
  const response = await apiFetch(`/tasks/${id}/base-info`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse<TaskRecord>(response)
}

export async function clearTaskTempFiles(id: number): Promise<void> {
  const response = await apiFetch(`/tasks/${id}/clear-temp`, {
    method: 'POST',
  })
  await parseResponse<{ message: string }>(response)
}

export async function fetchHeaderPresets(): Promise<HeaderPreset[]> {
  const response = await apiFetch('/header-presets')
  return parseResponse<HeaderPreset[]>(response)
}

export async function saveHeaderPreset(request: HeaderPreset): Promise<HeaderPreset> {
  const response = await apiFetch('/header-presets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  return parseResponse<HeaderPreset>(response)
}

export async function deleteHeaderPreset(host: string): Promise<void> {
  const response = await apiFetch(`/header-presets/${encodeURIComponent(host)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || '删除预设失败')
  }
}
