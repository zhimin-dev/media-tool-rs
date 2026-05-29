import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { createHeaderPreset, createTask, fetchHeaderPresets, fetchTasks } from './api'
import M3u8Player from './components/M3u8Player'
import type {
  CombinePayload,
  CutPayload,
  DownloadPayload,
  HeaderPreset,
  TaskPayload,
  TaskRecord,
  TaskStatus,
} from './types'

const statusLabelMap: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  success: '成功',
  failed: '失败',
}

const statusColorMap: Record<
  TaskStatus,
  'default' | 'primary' | 'success' | 'error' | 'warning'
> = {
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

function App() {
  const [tab, setTab] = useState(0)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [playerUrl, setPlayerUrl] = useState('')
  const [downloadForm, setDownloadForm] = useState(defaultDownloadForm)
  const [downloadHeaders, setDownloadHeaders] = useState([
    { id: crypto.randomUUID(), key: '', value: '' },
  ])
  const [headerPresets, setHeaderPresets] = useState<HeaderPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [presetHost, setPresetHost] = useState('')
  const [combineForm, setCombineForm] = useState(defaultCombineForm)
  const [cutForm, setCutForm] = useState(defaultCutForm)

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
    const timer = window.setInterval(() => {
      void loadTasks()
    }, 2000)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const records = await fetchHeaderPresets()
        setHeaderPresets(records)
      } catch {
        // no-op
      }
    }
    void loadPresets()
  }, [])

  const currentPayload = useMemo<TaskPayload>(() => {
    if (tab === 0) {
      return { ...downloadForm, headers: toHeaderMap(downloadHeaders) }
    }
    if (tab === 1) {
      return combineForm
    }
    return cutForm
  }, [combineForm, cutForm, downloadForm, tab])

  const commandPreview = useMemo(() => buildCommandPreview(currentPayload), [currentPayload])

  const handleCreateTask = async () => {
    setLoading(true)
    setError('')
    setSuccessMessage('')

    try {
      validatePayload(currentPayload)
      const task = await createTask({ payload: currentPayload })
      setTasks((current) => [task, ...current])
      setSuccessMessage('任务已创建')
      if (currentPayload.kind === 'download') {
        setPlayerUrl(currentPayload.url)
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : '创建任务失败'
      setError(message)
    } finally {
      setLoading(false)
    }

    const applyPreset = (presetId: string) => {
      setSelectedPresetId(presetId)
      const preset = headerPresets.find((item) => item.id === presetId)
      if (!preset) {
        setDownloadHeaders([{ id: crypto.randomUUID(), key: '', value: '' }])
        return
      }
      setDownloadHeaders(
        Object.entries(preset.headers).map(([key, value]) => ({
          id: crypto.randomUUID(),
          key,
          value,
        })),
      )
    }

    const handleSavePreset = async () => {
      const headers = toHeaderEntries(downloadHeaders)
      const host = presetHost.trim() || getHostFromUrl(downloadForm.url)
      if (!presetName.trim() || !host || headers.length === 0) {
        setError('请填写预设名称、host，并至少添加一个 header')
        return
      }
      try {
        const saved = await createHeaderPreset({
          name: presetName.trim(),
          host,
          headers,
        })
        const records = await fetchHeaderPresets()
        setHeaderPresets(records)
        setSelectedPresetId(saved.id)
        setSuccessMessage('header 预设已保存')
        setError('')
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : '保存预设失败'
        setError(message)
      }
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              media-tool-rs 控制台
            </Typography>
            <Typography variant="body2" color="text.secondary">
              React + Material UI 可视化任务界面，支持下载、合并、截取与 m3u8 在线播放。
            </Typography>
          </Box>
          <Chip label="macOS / Windows" color="primary" variant="outlined" />
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Stack spacing={3}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, lg: 7 }}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  新建任务
                </Typography>
                <Tabs value={tab} onChange={(_, nextTab) => setTab(nextTab)} sx={{ mb: 3 }}>
                  <Tab label="下载" />
                  <Tab label="合并" />
                  <Tab label="截取" />
                </Tabs>

                {tab === 0 ? (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        label="m3u8 链接"
                        value={downloadForm.url}
                        onChange={(event) =>
                          setDownloadForm((current) => ({ ...current, url: event.target.value }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        select
                        fullWidth
                        label="header 预设"
                        value={selectedPresetId}
                        onChange={(event) => applyPreset(event.target.value)}
                      >
                        <MenuItem value="">不使用预设</MenuItem>
                        {headerPresets.map((preset) => (
                          <MenuItem key={preset.id} value={preset.id}>
                            {preset.name} ({preset.host})
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="预设 host"
                        value={presetHost}
                        placeholder="如: surrit.com"
                        onChange={(event) => setPresetHost(event.target.value)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 8 }}>
                      <TextField
                        fullWidth
                        label="预设名称"
                        value={presetName}
                        placeholder="如: missav"
                        onChange={(event) => setPresetName(event.target.value)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Button fullWidth variant="outlined" sx={{ height: '100%' }} onClick={handleSavePreset}>
                        保存为预设
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="subtitle2">自定义 headers</Typography>
                    </Grid>
                    {downloadHeaders.map((entry, index) => (
                      <Grid key={entry.id} size={{ xs: 12 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <TextField
                            fullWidth
                            label="Header Key"
                            value={entry.key}
                            onChange={(event) =>
                              setDownloadHeaders((current) =>
                                current.map((item) =>
                                  item.id === entry.id ? { ...item, key: event.target.value } : item,
                                ),
                              )
                            }
                          />
                          <TextField
                            fullWidth
                            label="Header Value"
                            value={entry.value}
                            onChange={(event) =>
                              setDownloadHeaders((current) =>
                                current.map((item) =>
                                  item.id === entry.id ? { ...item, value: event.target.value } : item,
                                ),
                              )
                            }
                          />
                          <Button
                            color="error"
                            onClick={() =>
                              setDownloadHeaders((current) =>
                                current.length > 1
                                  ? current.filter((item) => item.id !== entry.id)
                                  : [{ id: crypto.randomUUID(), key: '', value: '' }],
                              )
                            }
                          >
                            删除
                          </Button>
                        </Stack>
                      </Grid>
                    ))}
                    <Grid size={{ xs: 12 }}>
                      <Button
                        variant="text"
                        onClick={() =>
                          setDownloadHeaders((current) => [
                            ...current,
                            { id: crypto.randomUUID(), key: '', value: '' },
                          ])
                        }
                      >
                        添加 Header
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="输出文件名"
                        value={downloadForm.target_file_name}
                        onChange={(event) =>
                          setDownloadForm((current) => ({
                            ...current,
                            target_file_name: event.target.value,
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="任务文件夹"
                        value={downloadForm.folder}
                        onChange={(event) =>
                          setDownloadForm((current) => ({ ...current, folder: event.target.value }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="下载目录"
                        value={downloadForm.download_dir}
                        onChange={(event) =>
                          setDownloadForm((current) => ({
                            ...current,
                            download_dir: event.target.value,
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="并发数"
                        type="number"
                        value={downloadForm.concurrent}
                        onChange={(event) =>
                          setDownloadForm((current) => ({
                            ...current,
                            concurrent: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={downloadForm.ffmpeg_download}
                            onChange={(event) =>
                              setDownloadForm((current) => ({
                                ...current,
                                ffmpeg_download: event.target.checked,
                              }))
                            }
                          />
                        }
                        label="使用 ffmpeg 直接下载"
                      />
                    </Grid>
                  </Grid>
                ) : null}

                {tab === 1 ? (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        label="文件正则模式"
                        value={combineForm.reg_name}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            reg_name: event.target.value,
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="开始索引"
                        type="number"
                        value={combineForm.reg_name_start}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            reg_name_start: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="结束索引"
                        type="number"
                        value={combineForm.reg_name_end}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            reg_name_end: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="输出文件名"
                        value={combineForm.target_file_name}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            target_file_name: event.target.value,
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="same_param_index"
                        type="number"
                        value={combineForm.same_param_index}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            same_param_index: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="FPS"
                        type="number"
                        value={combineForm.set_fps}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            set_fps: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="音频码率"
                        type="number"
                        value={combineForm.set_a_b}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            set_a_b: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="视频码率"
                        type="number"
                        value={combineForm.set_v_b}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            set_v_b: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="宽度"
                        type="number"
                        value={combineForm.set_width}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            set_width: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="高度"
                        type="number"
                        value={combineForm.set_height}
                        onChange={(event) =>
                          setCombineForm((current) => ({
                            ...current,
                            set_height: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                  </Grid>
                ) : null}

                {tab === 2 ? (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        label="输入文件"
                        value={cutForm.input}
                        onChange={(event) =>
                          setCutForm((current) => ({ ...current, input: event.target.value }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="开始秒数"
                        type="number"
                        value={cutForm.start}
                        onChange={(event) =>
                          setCutForm((current) => ({
                            ...current,
                            start: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="持续时长"
                        type="number"
                        value={cutForm.duration}
                        onChange={(event) =>
                          setCutForm((current) => ({
                            ...current,
                            duration: Number(event.target.value),
                          }))
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        fullWidth
                        label="输出文件名"
                        value={cutForm.target_file_name}
                        onChange={(event) =>
                          setCutForm((current) => ({
                            ...current,
                            target_file_name: event.target.value,
                          }))
                        }
                      />
                    </Grid>
                  </Grid>
                ) : null}

                <Divider sx={{ my: 3 }} />

                <Stack spacing={2}>
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      命令预览
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {commandPreview}
                    </Paper>
                  </Box>
                  <Box>
                    <Button variant="contained" size="large" onClick={handleCreateTask} disabled={loading}>
                      {loading ? '提交中...' : '新建任务'}
                    </Button>
                  </Box>
                </Stack>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, lg: 5 }}>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="在线播放 m3u8 链接"
                  value={playerUrl}
                  onChange={(event) => setPlayerUrl(event.target.value)}
                  helperText="支持直接输入或复用下载任务的 m3u8 链接"
                />
                <M3u8Player url={playerUrl} />
              </Stack>
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              任务结果
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              自动轮询任务状态，显示最终输出路径与执行结果。
            </Typography>
            <Stack spacing={2}>
              {tasks.length === 0 ? (
                <Alert severity="info">暂无任务，请先新建一个任务。</Alert>
              ) : (
                tasks.map((task) => (
                  <Card key={task.id} variant="outlined">
                    <CardContent>
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={2}
                        sx={{ justifyContent: 'space-between' }}
                      >
                        <Box sx={{ flex: 1 }}>
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ mb: 1, alignItems: { xs: 'flex-start', sm: 'center' } }}
                          >
                            <Typography variant="h6">{task.title}</Typography>
                            <Chip
                              size="small"
                              label={statusLabelMap[task.status]}
                              color={statusColorMap[task.status]}
                            />
                          </Stack>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: 'monospace',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              mb: 1,
                            }}
                          >
                            {task.command_preview}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {task.message ?? '等待结果'}
                          </Typography>
                          {task.result_path ? (
                            <Typography variant="body2" sx={{ mt: 1 }}>
                              输出文件：{task.result_path}
                            </Typography>
                          ) : null}
                        </Box>
                        <Box sx={{ minWidth: 180 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            创建时间：{formatTimestamp(task.created_at)}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            开始时间：{formatTimestamp(task.started_at)}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            完成时间：{formatTimestamp(task.finished_at)}
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                ))
              )}
            </Stack>
          </Paper>
        </Stack>
      </Container>
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
      Object.entries(payload.headers).forEach(([key, value]) => {
        parts.push(`--header ${key}:${value}`)
      })
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
      if (payload.set_fps > 0) {
        parts.push(`--set_fps=${payload.set_fps}`)
      }
      if (payload.set_a_b > 0) {
        parts.push(`--set_a_b=${payload.set_a_b}`)
      }
      if (payload.set_v_b > 0) {
        parts.push(`--set_v_b=${payload.set_v_b}`)
      }
      if (payload.set_width > 0) {
        parts.push(`--set_width=${payload.set_width}`)
      }
      if (payload.set_height > 0) {
        parts.push(`--set_height=${payload.set_height}`)
      }
      return parts.join(' ')
    }
    case 'cut': {
      const parts = [
        'media-tool-rs cut',
        `-i=${payload.input}`,
        `-s=${payload.start}`,
        `-d=${payload.duration}`,
      ]
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

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return '--'
  }

  return new Date(timestamp * 1000).toLocaleString()
}

export default App

function toHeaderEntries(entries: Array<{ key: string; value: string }>) {
  return entries
    .map((entry) => ({
      key: entry.key.trim(),
      value: entry.value.trim(),
    }))
    .filter((entry) => entry.key && entry.value)
}

function toHeaderMap(entries: Array<{ key: string; value: string }>) {
  const headers: Record<string, string> = {}
  toHeaderEntries(entries).forEach((entry) => {
    headers[entry.key] = entry.value
  })
  return headers
}

function getHostFromUrl(url: string) {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}
