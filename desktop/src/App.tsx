import MenuIcon from '@mui/icons-material/Menu'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import {
  createTask,
  deleteHeaderPreset,
  deleteTask,
  fetchHeaderPresets,
  fetchTaskDetail,
  fetchTasks,
  retryTask,
  saveHeaderPreset,
} from './api'
import M3u8Player from './components/M3u8Player'
import type {
  CombinePayload,
  CutPayload,
  DownloadPayload,
  HeaderPreset,
  TaskDetail,
  TaskPayload,
  TaskRecord,
  TaskStatus,
} from './types'

type TaskTab = 'download' | 'combine' | 'cut' | 'headers' | 'watch'

const tabLabelMap: Record<TaskTab, string> = {
  download: '下载',
  combine: '合并',
  cut: '截取',
  headers: 'Header 预设',
  watch: '播放',
}

const statusLabelMap: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  success: '成功',
  failed: '失败',
}

const statusColorMap: Record<TaskStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> =
  {
    queued: 'warning',
    running: 'primary',
    success: 'success',
    failed: 'error',
  }

const defaultDownloadForm: DownloadPayload = {
  kind: 'download',
  url: '',
  ffmpeg_download: false,
  target_file_name: '',
  folder: '',
  concurrent: 10,
  download_dir: 'download',
  headers: {},
}

const defaultCombineForm: CombinePayload = {
  kind: 'combine',
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
}

type HeaderRow = {
  key: string
  value: string
}

function App() {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [activeTab, setActiveTab] = useState<TaskTab>('download')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [playerUrl, setPlayerUrl] = useState('')
  const [downloadForm, setDownloadForm] = useState(defaultDownloadForm)
  const [combineForm, setCombineForm] = useState(defaultCombineForm)
  const [cutForm, setCutForm] = useState(defaultCutForm)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [headerPresets, setHeaderPresets] = useState<HeaderPreset[]>([])
  const [selectedPresetHost, setSelectedPresetHost] = useState('')
  const [presetFormHost, setPresetFormHost] = useState('')
  const [presetFormRows, setPresetFormRows] = useState<HeaderRow[]>([{ key: '', value: '' }])
  const [editingPresetHost, setEditingPresetHost] = useState('')

  useEffect(() => {
    let alive = true

    const loadTasks = async () => {
      try {
        const records = await fetchTasks()
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
    const timer = window.setInterval(() => void loadTasks(), 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

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

  const currentPayload = useMemo<TaskPayload>(() => {
    if (activeTab === 'download') {
      return {
        ...downloadForm,
        headers: selectedPreset?.headers ?? {},
      }
    }
    if (activeTab === 'combine') {
      return combineForm
    }
    return cutForm
  }, [activeTab, combineForm, cutForm, downloadForm, selectedPreset])

  const matchedPresetHost = useMemo(() => getHostFromUrl(downloadForm.url), [downloadForm.url])

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) =>
        activeTab === 'watch' ? true : task.payload.kind === activeTab,
      ),
    [activeTab, tasks],
  )

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

  const handlePresetChange = (host: string) => {
    setSelectedPresetHost(host)
  }

  const handleEditPreset = (preset: HeaderPreset) => {
    setEditingPresetHost(preset.host)
    setPresetFormHost(preset.host)
    setPresetFormRows(mapToHeaderRows(preset.headers))
    setActiveTab('headers')
  }

  const resetPresetForm = () => {
    setEditingPresetHost('')
    setPresetFormHost('')
    setPresetFormRows([{ key: '', value: '' }])
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
      setTasks((current) => [task, ...current])
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

  const createTitle = activeTab === 'watch' ? '新建任务' : `新建${tabLabelMap[activeTab]}任务`
  const commandPreview = buildCommandPreview(currentPayload)

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} color="primary">
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              media-tool-rs
            </Typography>
          </Stack>
          <Chip label="iOS / Android / macOS / Windows" color="primary" variant="outlined" />
        </Toolbar>
      </AppBar>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {(['download', 'combine', 'cut', 'headers', 'watch'] as TaskTab[]).map((tab) => (
          <MenuItem
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              setCreateDialogOpen(false)
              setMenuAnchor(null)
            }}
          >
            {tabLabelMap[tab]}
          </MenuItem>
        ))}
      </Menu>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h5">{tabLabelMap[activeTab]}页面</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}

          {activeTab === 'watch' ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="m3u8 链接"
                  value={playerUrl}
                  onChange={(event) => setPlayerUrl(event.target.value)}
                />
                <M3u8Player url={playerUrl} />
              </Stack>
            </Paper>
          ) : activeTab === 'headers' ? (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ justifyContent: 'space-between' }}
                  >
                    <Typography variant="h6">Header 预设列表</Typography>
                    <Button variant="outlined" onClick={resetPresetForm}>
                      新建预设
                    </Button>
                  </Stack>
                  {headerPresets.length === 0 ? (
                    <Alert severity="info">暂无预设</Alert>
                  ) : (
                    <Stack spacing={1}>
                      {headerPresets.map((preset) => (
                        <Card key={preset.host} variant="outlined">
                          <CardContent>
                            <Stack spacing={1}>
                              <Typography variant="subtitle1">{preset.host}</Typography>
                              <Typography
                                variant="body2"
                                sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                              >
                                {JSON.stringify(preset.headers)}
                              </Typography>
                              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <Button variant="outlined" size="small" onClick={() => handleEditPreset(preset)}>
                                  编辑
                                </Button>
                                <Button
                                  color="error"
                                  variant="outlined"
                                  size="small"
                                  onClick={() => void handleDeletePreset(preset.host)}
                                >
                                  删除
                                </Button>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={2}>
                  <Typography variant="h6">{editingPresetHost ? '编辑预设' : '新建预设'}</Typography>
                  <TextField
                    fullWidth
                    label="预设 Host"
                    placeholder="例如 surrit.com"
                    value={presetFormHost}
                    onChange={(event) => setPresetFormHost(event.target.value)}
                    helperText={matchedPresetHost ? `当前下载链接 host：${matchedPresetHost}` : undefined}
                  />
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Header 列表</Typography>
                    {presetFormRows.map((row, index) => (
                      <Stack key={`${index}-${row.key}`} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <TextField
                          fullWidth
                          label="Header 名称"
                          value={row.key}
                          onChange={(event) => handlePresetHeaderChange(index, 'key', event.target.value)}
                        />
                        <TextField
                          fullWidth
                          label="Header 值"
                          value={row.value}
                          onChange={(event) => handlePresetHeaderChange(index, 'value', event.target.value)}
                        />
                        <Button color="error" variant="outlined" onClick={() => handleRemovePresetHeader(index)}>
                          删除
                        </Button>
                      </Stack>
                    ))}
                    <Box>
                      <Button variant="text" onClick={handleAddPresetHeader}>
                        添加 Header
                      </Button>
                    </Box>
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button variant="contained" onClick={() => void handleSavePreset()}>
                      保存预设
                    </Button>
                    <Button variant="outlined" onClick={resetPresetForm}>
                      重置
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            </Stack>
          ) : (
            <>
              <Button variant="contained" onClick={() => setCreateDialogOpen(true)}>
                {createTitle}
              </Button>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  任务列表
                </Typography>
                <Stack spacing={2}>
                  {filteredTasks.length === 0 ? (
                    <Alert severity="info">暂无任务</Alert>
                  ) : (
                    filteredTasks.map((task) => (
                      <Card key={task.id} variant="outlined">
                        <CardContent>
                          <Stack spacing={1}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Typography variant="subtitle1">{task.title}</Typography>
                              <Chip
                                size="small"
                                label={statusLabelMap[task.status]}
                                color={statusColorMap[task.status]}
                              />
                            </Stack>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              {task.command_preview}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {task.message ?? '等待结果'}
                            </Typography>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                              <Button variant="outlined" size="small" onClick={() => handleView(task.id)}>
                                查看
                              </Button>
                              <Button variant="outlined" size="small" onClick={() => void handleRetry(task.id)}>
                                重试
                              </Button>
                              <Button color="error" variant="outlined" size="small" onClick={() => void handleDelete(task.id)}>
                                删除
                              </Button>
                            </Stack>
                          </Stack>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </Stack>
              </Paper>
            </>
          )}
        </Stack>
      </Container>

      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{createTitle}</DialogTitle>
        <DialogContent>
          {activeTab === 'download' ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                fullWidth
                label="m3u8 链接"
                value={downloadForm.url}
                onChange={(event) => {
                  const url = event.target.value
                  setDownloadForm((current) => ({ ...current, url }))
                }}
              />
              <TextField
                fullWidth
                label="输出文件名"
                value={downloadForm.target_file_name}
                onChange={(event) =>
                  setDownloadForm((current) => ({ ...current, target_file_name: event.target.value }))
                }
              />
              <TextField
                fullWidth
                label="任务文件夹"
                value={downloadForm.folder}
                onChange={(event) => setDownloadForm((current) => ({ ...current, folder: event.target.value }))}
              />
              <FormControl fullWidth>
                <InputLabel id="header-preset-label">header 预设</InputLabel>
                <Select
                  labelId="header-preset-label"
                  label="header 预设"
                  value={selectedPresetHost}
                  onChange={(event) => handlePresetChange(event.target.value)}
                >
                  <MenuItem value="">不使用预设</MenuItem>
                  {headerPresets.map((preset) => (
                    <MenuItem key={preset.host} value={preset.host}>
                      {preset.host}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {matchedPresetHost ? (
                <Typography variant="body2" color="text.secondary">
                  当前链接 host：{matchedPresetHost}
                </Typography>
              ) : null}
              {selectedPreset ? (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">当前预设内容</Typography>
                    <Typography variant="body2">{selectedPreset.host}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {JSON.stringify(selectedPreset.headers)}
                    </Typography>
                  </Stack>
                </Paper>
              ) : (
                <Alert severity="info">未选择 header 预设时，将不会传入下载 header。</Alert>
              )}
              <Button
                variant="outlined"
                onClick={() => {
                  setCreateDialogOpen(false)
                  setActiveTab('headers')
                }}
              >
                前往管理 Header 预设
              </Button>
            </Stack>
          ) : null}
          {activeTab === 'combine' ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                fullWidth
                label="文件正则模式"
                value={combineForm.reg_name}
                onChange={(event) => setCombineForm((current) => ({ ...current, reg_name: event.target.value }))}
              />
              <TextField
                fullWidth
                label="开始索引"
                type="number"
                value={combineForm.reg_name_start}
                onChange={(event) =>
                  setCombineForm((current) => ({ ...current, reg_name_start: Number(event.target.value) }))
                }
              />
              <TextField
                fullWidth
                label="结束索引"
                type="number"
                value={combineForm.reg_name_end}
                onChange={(event) =>
                  setCombineForm((current) => ({ ...current, reg_name_end: Number(event.target.value) }))
                }
              />
            </Stack>
          ) : null}
          {activeTab === 'cut' ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                fullWidth
                label="输入文件"
                value={cutForm.input}
                onChange={(event) => setCutForm((current) => ({ ...current, input: event.target.value }))}
              />
              <TextField
                fullWidth
                label="开始秒数"
                type="number"
                value={cutForm.start}
                onChange={(event) => setCutForm((current) => ({ ...current, start: Number(event.target.value) }))}
              />
              <TextField
                fullWidth
                label="持续时长"
                type="number"
                value={cutForm.duration}
                onChange={(event) =>
                  setCutForm((current) => ({ ...current, duration: Number(event.target.value) }))
                }
              />
            </Stack>
          ) : null}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>
            命令预览
          </Typography>
          <Paper variant="outlined" sx={{ p: 1.5, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {commandPreview}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>取消</Button>
          <Button onClick={() => void handleCreateTask()} disabled={loading} variant="contained">
            {loading ? '提交中...' : '执行'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>任务详情</DialogTitle>
        <DialogContent>
          {detailLoading ? (
            <Typography>加载中...</Typography>
          ) : detail ? (
            <Stack spacing={1}>
              <Typography variant="body2">任务：{detail.task.title}</Typography>
              <Typography variant="body2">命令：{detail.task.command_preview}</Typography>
              <Typography variant="body2">输出目录：{detail.output_dir ?? '--'}</Typography>
              <Typography variant="subtitle2">目录内容：</Typography>
              <List dense>
                {detail.output_files.length === 0 ? (
                  <ListItem>暂无文件</ListItem>
                ) : (
                  detail.output_files.map((file) => <ListItem key={file}>{file}</ListItem>)
                )}
              </List>
            </Stack>
          ) : (
            <Typography>暂无详情</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
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
      if (payload.target_file_name) {
        parts.push(`--target_file_name=${payload.target_file_name}`)
      }
      if (payload.folder) {
        parts.push(`--folder=${payload.folder}`)
      }
      if (payload.concurrent !== 10) {
        parts.push(`--concurrent=${payload.concurrent}`)
      }
      if (payload.download_dir !== 'download') {
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
        `-r ${payload.reg_name}`,
        `--reg-file-start=${payload.reg_name_start}`,
        `--reg-file-end=${payload.reg_name_end}`,
      ]
      if (payload.target_file_name) {
        parts.push(`--target_file_name=${payload.target_file_name}`)
      }
      if (payload.same_param_index >= 0) {
        parts.push(`--same_param_index=${payload.same_param_index}`)
      }
      return parts.join(' ')
    }
    case 'cut': {
      const parts = ['media-tool-rs cut', `-i=${payload.input}`, `-s=${payload.start}`, `-d=${payload.duration}`]
      if (payload.target_file_name) {
        parts.push(`--target_file_name=${payload.target_file_name}`)
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
      if (!payload.reg_name.trim()) {
        throw new Error('请填写文件正则模式')
      }
      if (payload.reg_name_end < payload.reg_name_start) {
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

export default App
