import MenuIcon from '@mui/icons-material/Menu'
import { Alert, AppBar, Box, Container, IconButton, Menu, MenuItem, Stack, Toolbar, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  createTask,
  clearTaskTempFiles,
  deleteHeaderPreset,
  deleteTask,
  fetchHeaderPresets,
  fetchTaskDetail,
  fetchTasks,
  retryTask,
  saveHeaderPreset,
  updateTaskBaseInfo,
} from './api'
import { appPages, getPageFromPath, getPathForPage, isTaskPage, pageLabelMap, type TaskPage } from './appPages'
import BaseInfoEditDialog from './components/BaseInfoEditDialog'
import CreateTaskDialog from './components/CreateTaskDialog'
import TaskDetailDialog from './components/TaskDetailDialog'
import CombinePage from './pages/CombinePage'
import CutPage from './pages/CutPage'
import CutCreatePage from './pages/CutCreatePage'
import DownloadPage from './pages/DownloadPage'
import HeaderPresetsPage from './pages/HeaderPresetsPage'
import WatchPage from './pages/WatchPage'
import type {
  BaseInfo,
  CombinePayload,
  CutPayload,
  DownloadPayload,
  HeaderPreset,
  HeaderRow,
  TaskDetail,
  TaskPayload,
  TaskRecord,
} from './types'

const defaultDownloadForm: DownloadPayload = {
  kind: 'download',
  url: '',
  ffmpeg_download: false,
  auto_clear_temp_files: true,
  target_file_name: '',
  folder: '',
  concurrent: 10,
  download_dir: 'static/download',
  headers: {},
}

const defaultCombineForm: CombinePayload = {
  kind: 'combine',
  inputs: [],
  reg_name: '',
  reg_name_start: 1,
  reg_name_end: 1,
  target_file_name: '',
  same_param_index: -1,
  set_fps: 0,
  set_a_b: 0,
  set_v_b: 0,
  set_height: 0,
  set_width: 0,
}

const defaultCutForm: CutPayload = {
  kind: 'cut',
  input: '',
  start: 0,
  duration: 3,
  target_file_name: '',
delete_input_file: false,
}

const defaultBaseInfoForm: BaseInfo = {
  url: '',
  m3u8_name: '',
  header: {},
  target_file_name: '',
  folder: '',
  concurrent: 10,
  download_dir: 'static/download',
  ffmpeg_download: false,
  auto_clear_temp_files: true,
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPage = useMemo(() => getPageFromPath(location.pathname), [location.pathname])
  const currentTaskPage: TaskPage = isTaskPage(currentPage) ? currentPage : 'download'
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [playerUrl, setPlayerUrl] = useState('')
  const [playerHeaderRows, setPlayerHeaderRows] = useState<HeaderRow[]>([{ key: '', value: '' }])
  const [taskRefreshInterval, setTaskRefreshInterval] = useState(3000)
  const [downloadForm, setDownloadForm] = useState(defaultDownloadForm)
  const [combineForm, setCombineForm] = useState(defaultCombineForm)
  const [cutForm, setCutForm] = useState(defaultCutForm)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [baseInfoEditOpen, setBaseInfoEditOpen] = useState(false)
  const [baseInfoEditLoading, setBaseInfoEditLoading] = useState(false)
  const [baseInfoEditingTaskId, setBaseInfoEditingTaskId] = useState<number | null>(null)
  const [baseInfoForm, setBaseInfoForm] = useState<BaseInfo>(defaultBaseInfoForm)
  const [baseInfoHeaderText, setBaseInfoHeaderText] = useState('{}')
  const [headerPresets, setHeaderPresets] = useState<HeaderPreset[]>([])
  const [selectedPresetHost, setSelectedPresetHost] = useState('')
  const [presetFormHost, setPresetFormHost] = useState('')
  const [presetFormRows, setPresetFormRows] = useState<HeaderRow[]>([{ key: '', value: '' }])
  const [editingPresetHost, setEditingPresetHost] = useState('')
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)

  useEffect(() => {
    let alive = true

    const loadTasks = async () => {
      try {
        const records = await fetchTasks(currentTaskPage)
        if (alive) {
          setTasks(records)
          setError('')
        }
      } catch {
        if (alive) {
          setError('无法连接后端接口，请先执行 media-tool-rs serve --port 8080')
        }
      }
    }

    void loadTasks()
    const timer = window.setInterval(() => void loadTasks(), taskRefreshInterval)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [currentTaskPage, taskRefreshInterval])

  const handleManualRefresh = async () => {
    try {
      const records = await fetchTasks(currentTaskPage)
      setTasks(records)
      setError('')
    } catch {
      setError('无法连接后端接口，请先执行 media-tool-rs serve --port 8080')
    }
  }

  useEffect(() => {
    let alive = true

    const loadHeaderPresets = async () => {
      try {
        const presets = await fetchHeaderPresets()
        if (alive) {
          setHeaderPresets(presets)
        }
      } catch {
        if (alive) {
          setError('加载 header 预设失败')
        }
      }
    }

    void loadHeaderPresets()
    return () => {
      alive = false
    }
  }, [])

  const selectedPreset = useMemo(
    () => headerPresets.find((item) => item.host === selectedPresetHost) ?? null,
    [headerPresets, selectedPresetHost],
  )

  const matchedPresetHost = useMemo(() => getHostFromUrl(downloadForm.url), [downloadForm.url])
  const playerHeaders = useMemo(() => headerRowsToMap(playerHeaderRows), [playerHeaderRows])
  const downloadTasks = useMemo(() => tasks.filter((task) => task.payload.kind === 'download'), [tasks])
  const combineTasks = useMemo(() => tasks.filter((task) => task.payload.kind === 'combine'), [tasks])
  const cutTasks = useMemo(
    () => tasks.filter((task) => task.payload.kind === 'cut' || task.payload.kind === 'cut_batch'),
    [tasks],
  )

  const currentPayload = useMemo<TaskPayload>(() => {
    if (currentTaskPage === 'download') {
      return {
        ...downloadForm,
        headers: selectedPreset?.headers ?? {},
      }
    }
    if (currentTaskPage === 'combine') {
      return combineForm
    }
    return cutForm
  }, [combineForm, currentTaskPage, cutForm, downloadForm, selectedPreset])

  const createTitle = `新建${pageLabelMap[currentTaskPage]}任务`
  const commandPreview = buildCommandPreview(currentPayload)
  const baseInfoCommandPreview = useMemo(() => {
    const payload: DownloadPayload = {
      kind: 'download',
      url: baseInfoForm.url,
      ffmpeg_download: baseInfoForm.ffmpeg_download,
      auto_clear_temp_files: baseInfoForm.auto_clear_temp_files,
      target_file_name: baseInfoForm.target_file_name,
      folder: baseInfoForm.folder,
      concurrent: baseInfoForm.concurrent,
      download_dir: baseInfoForm.download_dir,
      headers: baseInfoForm.header,
    }
    return buildCommandPreview(payload)
  }, [baseInfoForm])

  const handlePlayerHeaderChange = (index: number, field: keyof HeaderRow, value: string) => {
    setPlayerHeaderRows((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    )
  }

  const handleAddPlayerHeader = () => {
    setPlayerHeaderRows((current) => [...current, { key: '', value: '' }])
  }

  const handleRemovePlayerHeader = (index: number) => {
    setPlayerHeaderRows((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length > 0 ? next : [{ key: '', value: '' }]
    })
  }

  const handleCreateTask = async () => {
    setLoading(true)
    setError('')
    setSuccessMessage('')
    try {
      validatePayload(currentPayload)
      const task = await createTask({ payload: currentPayload })
      setTasks((current) => [task, ...current])
      setCreateDialogOpen(false)
      setSuccessMessage('任务已创建')
      if (currentPayload.kind === 'download') {
        setPlayerUrl(currentPayload.url)
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '创建任务失败'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handlePresetHeaderChange = (index: number, field: keyof HeaderRow, value: string) => {
    setPresetFormRows((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    )
  }

  const handleAddPresetHeader = () => {
    setPresetFormRows((current) => [...current, { key: '', value: '' }])
  }

  const handleRemovePresetHeader = (index: number) => {
    setPresetFormRows((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length > 0 ? next : [{ key: '', value: '' }]
    })
  }

  const handleEditPreset = (preset: HeaderPreset) => {
    setEditingPresetHost(preset.host)
    setPresetFormHost(preset.host)
    setPresetFormRows(mapToHeaderRows(preset.headers))
    setPresetDialogOpen(true)
  }

  const resetPresetForm = () => {
    setEditingPresetHost('')
    setPresetFormHost('')
    setPresetFormRows([{ key: '', value: '' }])
  }

  const handleOpenNewPreset = () => {
    resetPresetForm()
    setPresetDialogOpen(true)
  }

  const handleSavePreset = async () => {
    const host = (presetFormHost.trim() || matchedPresetHost).toLowerCase()
    const headers = headerRowsToMap(presetFormRows)

    if (!host) {
      setError('请填写预设 host')
      return
    }

    if (Object.keys(headers).length === 0) {
      setError('请至少填写一个 header')
      return
    }

    try {
      const preset = await saveHeaderPreset({ host, headers })
      setHeaderPresets((current) => {
        const next = current.filter((item) => item.host !== preset.host)
        next.push(preset)
        next.sort((left, right) => left.host.localeCompare(right.host))
        return next
      })
      setSelectedPresetHost(preset.host)
      setEditingPresetHost(preset.host)
      setPresetFormHost(preset.host)
      setPresetDialogOpen(false)
      setSuccessMessage('header 预设已保存')
      setError('')
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '保存预设失败'
      setError(message)
    }
  }

  const handleDeletePreset = async (host: string) => {
    try {
      await deleteHeaderPreset(host)
      setHeaderPresets((current) => current.filter((item) => item.host !== host))
      setSelectedPresetHost((current) => (current === host ? '' : current))
      if (editingPresetHost === host) {
        resetPresetForm()
        setPresetDialogOpen(false)
      }
      setSuccessMessage('header 预设已删除')
      setError('')
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '删除预设失败'
      setError(message)
    }
  }

  const handleRetry = async (taskId: number) => {
    try {
      const task = await retryTask(taskId)
      setTasks((current) => [task, ...current.filter((item) => item.id !== taskId)])
      setSuccessMessage('已重新创建任务')
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '重试失败'
      setError(message)
    }
  }

  const handleDelete = async (taskId: number) => {
    try {
      await deleteTask(taskId)
      setTasks((current) => current.filter((task) => task.id !== taskId))
      setSuccessMessage('任务已删除')
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '删除失败'
      setError(message)
    }
  }

  const handleClearTempFiles = async (taskId: number) => {
    try {
      await clearTaskTempFiles(taskId)
      setSuccessMessage('临时文件已清理')
      setError('')
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '清理临时文件失败'
      setError(message)
    }
  }

  const handleView = async (taskId: number) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      const result = await fetchTaskDetail(taskId)
      setDetail(result)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '加载任务详情失败'
      setError(message)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleOpenVideo = (task: TaskRecord) => {
    if (!task.result_path) {
      setError('未找到视频输出文件')
      return
    }

    setError('')
    let videoUrl: string
    if (task.payload.kind === 'download') {
      videoUrl = `/static/download/${task.payload.folder}/${task.payload.target_file_name}`
    } else {
      // combine and cut — use the serve-video API with the absolute result path
      videoUrl = `/api/serve-video?path=${encodeURIComponent(task.result_path)}`
    }
    setPlayerUrl(videoUrl)
    navigate(getPathForPage('watch'))
  }

  const handleOpenBaseInfoEditor = async (taskId: number) => {
    setBaseInfoEditLoading(true)
    setError('')
    try {
      const taskDetail = await fetchTaskDetail(taskId)
      const payload = taskDetail.task.payload
      if (payload.kind !== 'download') {
        throw new Error('仅下载任务支持编辑 base_info.json')
      }
      const source = taskDetail.base_info ?? {
        ...defaultBaseInfoForm,
        url: payload.url,
        target_file_name: payload.target_file_name,
        folder: payload.folder,
        concurrent: payload.concurrent,
        download_dir: payload.download_dir,
        ffmpeg_download: payload.ffmpeg_download,
        auto_clear_temp_files: payload.auto_clear_temp_files,
        header: payload.headers,
      }
      setBaseInfoEditingTaskId(taskId)
      setBaseInfoForm(source)
      setBaseInfoHeaderText(JSON.stringify(source.header ?? {}, null, 2))
      setBaseInfoEditOpen(true)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '加载 base_info 失败'
      setError(message)
    } finally {
      setBaseInfoEditLoading(false)
    }
  }

  const handleSaveBaseInfo = async () => {
    if (!baseInfoEditingTaskId) {
      return
    }

    let parsedHeaders: Record<string, string>
    try {
      parsedHeaders = JSON.parse(baseInfoHeaderText || '{}') as Record<string, string>
    } catch {
      setError('Header JSON 格式错误')
      return
    }

    try {
      const updatedTask = await updateTaskBaseInfo(baseInfoEditingTaskId, {
        ...baseInfoForm,
        header: parsedHeaders,
      })
      setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)))
      setSuccessMessage('base_info.json 已更新')
      setError('')
      setBaseInfoEditOpen(false)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '更新 base_info 失败'
      setError(message)
    }
  }

  const handleMenuNavigate = (page: typeof appPages[number]) => {
    setMenuAnchor(null)
    navigate(page.path)
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} color="primary">
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {pageLabelMap[currentPage]}
            </Typography>
          </Stack>
        </Toolbar>
      </AppBar>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {appPages.map((page) => (
          <MenuItem key={page.key} selected={page.key === currentPage} onClick={() => handleMenuNavigate(page)}>
            {page.label}
          </MenuItem>
        ))}
      </Menu>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}

          <Routes>
            <Route path="/" element={<Navigate to={getPathForPage('download')} replace />} />
            <Route
              path="/download"
              element={
                <DownloadPage
                  tasks={downloadTasks}
                  refreshInterval={taskRefreshInterval}
                  baseInfoEditLoading={baseInfoEditLoading}
                  onCreate={() => setCreateDialogOpen(true)}
                  onRefresh={() => void handleManualRefresh()}
                  onRefreshIntervalChange={setTaskRefreshInterval}
                  onView={(taskId) => void handleView(taskId)}
                  onRetry={(taskId) => void handleRetry(taskId)}
                  onDelete={(taskId) => void handleDelete(taskId)}
                  onOpenVideo={handleOpenVideo}
                  onEditFailedTask={(taskId) => void handleOpenBaseInfoEditor(taskId)}
                  onClearTempFiles={(taskId) => void handleClearTempFiles(taskId)}
                />
              }
            />
            <Route
              path="/combine"
              element={
                <CombinePage
                  tasks={combineTasks}
                  refreshInterval={taskRefreshInterval}
                  baseInfoEditLoading={baseInfoEditLoading}
                  onCreate={() => {
                    setCombineForm(defaultCombineForm)
                    setCreateDialogOpen(true)
                  }}
                  onRefresh={() => void handleManualRefresh()}
                  onRefreshIntervalChange={setTaskRefreshInterval}
                  onView={(taskId) => void handleView(taskId)}
                  onRetry={(taskId) => void handleRetry(taskId)}
                  onDelete={(taskId) => void handleDelete(taskId)}
                  onOpenVideo={handleOpenVideo}
                />
              }
            />
            <Route
              path="/cut"
              element={
                <CutPage
                  tasks={cutTasks}
                  refreshInterval={taskRefreshInterval}
                  baseInfoEditLoading={baseInfoEditLoading}
                  onCreate={() => navigate('/cut/create')}
                  onRefresh={() => void handleManualRefresh()}
                  onRefreshIntervalChange={setTaskRefreshInterval}
                  onView={(taskId) => void handleView(taskId)}
                  onRetry={(taskId) => void handleRetry(taskId)}
                  onDelete={(taskId) => void handleDelete(taskId)}
                  onOpenVideo={handleOpenVideo}
                />
              }
            />
            <Route path="/cut/create" element={<CutCreatePage />} />
            <Route
              path="/headers"
              element={
                <HeaderPresetsPage
                  headerPresets={headerPresets}
                  presetDialogOpen={presetDialogOpen}
                  editingPresetHost={editingPresetHost}
                  presetFormHost={presetFormHost}
                  presetFormRows={presetFormRows}
                  matchedPresetHost={matchedPresetHost}
                  onOpenNewPreset={handleOpenNewPreset}
                  onClosePresetDialog={() => setPresetDialogOpen(false)}
                  onPresetFormHostChange={setPresetFormHost}
                  onPresetHeaderChange={handlePresetHeaderChange}
                  onAddPresetHeader={handleAddPresetHeader}
                  onRemovePresetHeader={handleRemovePresetHeader}
                  onResetPresetForm={resetPresetForm}
                  onSavePreset={() => void handleSavePreset()}
                  onEditPreset={handleEditPreset}
                  onDeletePreset={(host) => void handleDeletePreset(host)}
                />
              }
            />
            <Route
              path="/watch"
              element={
                <WatchPage
                  playerUrl={playerUrl}
                  playerHeaders={playerHeaders}
                  playerHeaderRows={playerHeaderRows}
                  onPlayerUrlChange={setPlayerUrl}
                  onPlayerHeaderChange={handlePlayerHeaderChange}
                  onAddPlayerHeader={handleAddPlayerHeader}
                  onRemovePlayerHeader={handleRemovePlayerHeader}
                />
              }
            />
            <Route path="*" element={<Navigate to={getPathForPage('download')} replace />} />
          </Routes>
        </Stack>
      </Container>

      <CreateTaskDialog
        key={`${currentTaskPage}-${createDialogOpen ? 'open' : 'closed'}`}
        open={createDialogOpen && isTaskPage(currentPage)}
        page={currentTaskPage}
        createTitle={createTitle}
        commandPreview={commandPreview}
        loading={loading}
        downloadForm={downloadForm}
        combineForm={combineForm}
        cutForm={cutForm}
        headerPresets={headerPresets}
        selectedPresetHost={selectedPresetHost}
        selectedPreset={selectedPreset}
        matchedPresetHost={matchedPresetHost}
        onPresetChange={setSelectedPresetHost}
        onDownloadFormChange={setDownloadForm}
        onCombineFormChange={setCombineForm}
        onCutFormChange={setCutForm}
        onClose={() => setCreateDialogOpen(false)}
        onManageHeaders={() => {
          setCreateDialogOpen(false)
          navigate(getPathForPage('headers'))
        }}
        onSubmit={() => void handleCreateTask()}
      />

      <TaskDetailDialog
        open={detailOpen}
        loading={detailLoading}
        detail={detail}
        onClose={() => setDetailOpen(false)}
        onOpenVideo={handleOpenVideo}
      />

      <BaseInfoEditDialog
        open={baseInfoEditOpen}
        baseInfoForm={baseInfoForm}
        baseInfoHeaderText={baseInfoHeaderText}
        commandPreview={baseInfoCommandPreview}
        onClose={() => setBaseInfoEditOpen(false)}
        onBaseInfoFormChange={setBaseInfoForm}
        onBaseInfoHeaderTextChange={setBaseInfoHeaderText}
        onSave={() => void handleSaveBaseInfo()}
      />
    </Box>
  )
}

function buildCommandPreview(payload: TaskPayload) {
  switch (payload.kind) {
    case 'download': {
      const parts = ['media-tool-rs download']
      if (payload.url) {
        parts.push(`--url=${payload.url}`)
      }
      if (payload.ffmpeg_download) {
        parts.push('--ffmpeg_download')
      }
      if (!payload.auto_clear_temp_files) {
        parts.push('--auto_clear_temp_files=false')
      }
      if (payload.target_file_name) {
        parts.push(`--target_file_name=${shellDoubleQuote(payload.target_file_name)}`)
      }
      if (payload.folder) {
        parts.push(`--folder=${payload.folder}`)
      }
      if (payload.concurrent !== 10) {
        parts.push(`--concurrent=${payload.concurrent}`)
      }
      if (payload.download_dir !== 'static/download') {
        parts.push(`--download_dir=${payload.download_dir}`)
      }
      if (Object.keys(payload.headers).length > 0) {
        parts.push(`--header=${formatHeaderCommandValue(payload.headers)}`)
      }
      return parts.join(' ')
    }
    case 'combine': {
      const parts = [
        'media-tool-rs combine',
      ]
      if (payload.inputs.length > 0) {
        parts.push(`--inputs=${shellDoubleQuote(payload.inputs.join(','))}`)
      } else {
        parts.push(`-r ${payload.reg_name}`)
        parts.push(`--reg-file-start=${payload.reg_name_start}`)
        parts.push(`--reg-file-end=${payload.reg_name_end}`)
      }
      if (payload.target_file_name) {
        parts.push(`--target_file_name=${shellDoubleQuote(payload.target_file_name)}`)
      }
      if (payload.same_param_index >= 0) {
        parts.push(`--same_param_index=${payload.same_param_index}`)
      }
      return parts.join(' ')
    }
    case 'cut': {
      const parts = ['media-tool-rs cut', `-i=${payload.input}`, `-s=${payload.start}`, `-d=${payload.duration}`]
      if (payload.delete_input_file) {
        parts.push('--delete_input_file')
      }
      if (payload.target_file_name) {
        parts.push(`--target_file_name=${shellDoubleQuote(payload.target_file_name)}`)
      }
      return parts.join(' ')
    }
    case 'cut_batch': {
      const parts = ['media-tool-rs cut-batch', `-i=${payload.input}`, `--segments=${payload.segments.length}`]
      if (payload.delete_input_file) {
        parts.push('--delete_input_file')
      }
      return parts.join(' ')
    }
  }
}

function validatePayload(payload: TaskPayload) {
  switch (payload.kind) {
    case 'download':
      if (!payload.url.trim()) {
        throw new Error('请填写 m3u8 链接')
      }
      return
    case 'combine':
      if (payload.inputs.length === 0 && !payload.reg_name.trim()) {
        throw new Error('请先选择文件或填写文件正则模式')
      }
      if (payload.inputs.length === 0 && payload.reg_name_end < payload.reg_name_start) {
        throw new Error('结束索引不能小于开始索引')
      }
      return
    case 'cut':
      if (!payload.input.trim()) {
        throw new Error('请填写输入文件路径')
      }
      if (payload.duration <= 0) {
        throw new Error('持续时长必须大于 0')
      }
  }
}

function headerRowsToMap(rows: HeaderRow[]) {
  return rows.reduce<Record<string, string>>((result, row) => {
    const key = row.key.trim()
    const value = row.value.trim()
    if (key && value) {
      result[key] = value
    }
    return result
  }, {})
}

function mapToHeaderRows(headers: Record<string, string>) {
  const rows = Object.entries(headers).map(([key, value]) => ({ key, value }))
  return rows.length > 0 ? rows : [{ key: '', value: '' }]
}

function getHostFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function formatHeaderCommandValue(headers: Record<string, string>) {
  return `'${JSON.stringify(headers).replaceAll("'", `'"'"'`)}'`
}

function shellDoubleQuote(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export default App
