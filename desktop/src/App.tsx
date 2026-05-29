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
  IconButton,
  List,
  ListItem,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { createTask, deleteTask, fetchTaskDetail, fetchTasks, retryTask } from './api'
import M3u8Player from './components/M3u8Player'
import type {
  CombinePayload,
  CutPayload,
  DownloadPayload,
  TaskDetail,
  TaskPayload,
  TaskRecord,
  TaskStatus,
} from './types'

type TaskTab = 'download' | 'combine' | 'cut' | 'watch'

const tabLabelMap: Record<TaskTab, string> = {
  download: '下载',
  combine: '合并',
  cut: '截取',
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

  const currentPayload = useMemo<TaskPayload>(() => {
    if (activeTab === 'download') {
      return downloadForm
    }
    if (activeTab === 'combine') {
      return combineForm
    }
    return cutForm
  }, [activeTab, combineForm, cutForm, downloadForm])

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
        {(['download', 'combine', 'cut', 'watch'] as TaskTab[]).map((tab) => (
          <MenuItem
            key={tab}
            onClick={() => {
              setActiveTab(tab)
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
                onChange={(event) => setDownloadForm((current) => ({ ...current, url: event.target.value }))}
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

export default App
