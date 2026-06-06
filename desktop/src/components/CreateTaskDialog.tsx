import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, InputAdornment, InputLabel, List, ListItem, ListItemText, MenuItem, Paper, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import type { TaskPage } from '../appPages'
import { probeVideo, uploadVideo } from '../api'
import type { CombinePayload, CutPayload, DownloadPayload, HeaderPreset, TranscodePayload, TranscodePreset, VideoProbeInfo } from '../types'

type CreateTaskDialogProps = {
  open: boolean
  page: TaskPage
  createTitle: string
  commandPreview: string
  loading: boolean
  downloadForm: DownloadPayload
  combineForm: CombinePayload
  cutForm: CutPayload
  transcodeForm: TranscodePayload
  headerPresets: HeaderPreset[]
  transcodePresets: TranscodePreset[]
  selectedPresetHost: string
  selectedPreset: HeaderPreset | null
  matchedPresetHost: string
  selectedTranscodePresetTitle: string
  onPresetChange: (host: string) => void
  onTranscodePresetChange: (title: string) => void
  onDownloadFormChange: Dispatch<SetStateAction<DownloadPayload>>
  onCombineFormChange: Dispatch<SetStateAction<CombinePayload>>
  onCutFormChange: Dispatch<SetStateAction<CutPayload>>
  onTranscodeFormChange: Dispatch<SetStateAction<TranscodePayload>>
  onClose: () => void
  onManageHeaders: () => void
  onManageTranscodePresets: () => void
  onSubmit: () => void
}

function generateTestFiles(regName: string, start: number, end: number): string[] {
  const files: string[] = []
  for (let i = start; i <= end; i++) {
    files.push(regName.replace('(.*)', String(i)))
  }
  return files
}

function CreateTaskDialog({
  open,
  page,
  createTitle,
  commandPreview,
  loading,
  downloadForm,
  combineForm,
  cutForm,
  transcodeForm,
  headerPresets,
  transcodePresets,
  selectedPresetHost,
  selectedPreset,
  matchedPresetHost,
  selectedTranscodePresetTitle,
  onPresetChange,
  onTranscodePresetChange,
  onDownloadFormChange,
  onCombineFormChange,
  onCutFormChange,
  onTranscodeFormChange,
  onClose,
  onManageHeaders,
  onManageTranscodePresets,
  onSubmit,
}: CreateTaskDialogProps) {
  const [testedKey, setTestedKey] = useState<string | null>(null)
  const [testPreviewOpen, setTestPreviewOpen] = useState(false)
  const [testFiles, setTestFiles] = useState<string[]>([])
  const [combineUploadLoading, setCombineUploadLoading] = useState(false)
  const [combineUploadError, setCombineUploadError] = useState('')
  const [combineUploadSubDir] = useState(() => generateRandomString(12))
  const [transcodeUploadLoading, setTranscodeUploadLoading] = useState(false)
  const [transcodeProbeLoading, setTranscodeProbeLoading] = useState(false)
  const [transcodeError, setTranscodeError] = useState('')
  const [videoProbeInfo, setVideoProbeInfo] = useState<VideoProbeInfo | null>(null)

  const handleTranscodeFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    setTranscodeUploadLoading(true)
    setTranscodeError('')
    try {
      const uploaded = await uploadVideo(file, {
        rootDir: 'uploads',
        preserveFileName: true,
      })
      onTranscodeFormChange((current) => ({
        ...current,
        input: uploaded.path,
      }))
      setVideoProbeInfo(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传转码文件失败'
      setTranscodeError(message)
    } finally {
      setTranscodeUploadLoading(false)
    }
  }

  const handleProbeVideo = async () => {
    if (!transcodeForm.input.trim()) {
      setTranscodeError('请先上传或填写输入视频路径')
      return
    }
    setTranscodeProbeLoading(true)
    setTranscodeError('')
    try {
      const result = await probeVideo(transcodeForm.input)
      setVideoProbeInfo(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : '分析视频失败'
      setTranscodeError(message)
    } finally {
      setTranscodeProbeLoading(false)
    }
  }

  const selectedTranscodePreset = transcodePresets.find((item) => item.title === selectedTranscodePresetTitle) ?? null

  const handleApplyTranscodePreset = (title: string) => {
    onTranscodePresetChange(title)
    const preset = transcodePresets.find((item) => item.title === title)
    if (!preset) {
      return
    }
    onTranscodeFormChange((current) => ({
      ...current,
      video_codec: preset.video_codec,
      resolution: preset.resolution,
      video_bitrate_kbps: preset.video_bitrate_kbps,
      fps: preset.fps,
      audio_codec: preset.audio_codec,
      audio_bitrate_kbps: preset.audio_bitrate_kbps,
      audio_channels: preset.audio_channels,
      audio_sample_rate: preset.audio_sample_rate,
    }))
  }

  // Derive tested: true only when the snapshot matches the current form values
  const formKey = [
    combineForm.reg_name,
    combineForm.reg_name_start,
    combineForm.reg_name_end,
    combineForm.target_file_name,
    combineForm.inputs.join('|'),
  ].join('|')
  const combineTested = testedKey !== null && testedKey === formKey

  const handleCombineFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    event.target.value = ''
    setCombineUploadLoading(true)
    setCombineUploadError('')
    try {
      const uploadedFiles = await Promise.all(
        files.map((file) =>
          uploadVideo(file, {
            rootDir: 'cut',
            subDir: combineUploadSubDir,
            preserveFileName: true,
          }),
        ),
      )
      const uploadedPaths = uploadedFiles.map((item) => item.path)
      onCombineFormChange((current) => ({
        ...current,
        inputs: uploadedPaths,
        reg_name_start: 1,
        reg_name_end: uploadedPaths.length,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传文件失败'
      setCombineUploadError(message)
    } finally {
      setCombineUploadLoading(false)
    }
  }

  const handleCombineTest = () => {
    if (!combineForm.target_file_name.trim()) {
      onCombineFormChange((current) => ({
        ...current,
        target_file_name: generateRandomFileName(12),
      }))
    }
    const files =
      combineForm.inputs.length > 0
        ? combineForm.inputs
        : generateTestFiles(
            combineForm.reg_name,
            combineForm.reg_name_start,
            combineForm.reg_name_end,
          )
    setTestFiles(files)
    setTestPreviewOpen(true)
  }

  const handleTestConfirm = () => {
    setTestPreviewOpen(false)
    setTestedKey(formKey)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{createTitle}</DialogTitle>
      <DialogContent>
        {page === 'download' ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="m3u8 链接"
              value={downloadForm.url}
              onChange={(event) => {
                const url = event.target.value
                onDownloadFormChange((current) => ({ ...current, url }))
              }}
            />
            <TextField
              fullWidth
              label="输出文件名"
              value={downloadForm.target_file_name}
              slotProps={{
                input: {
                  endAdornment: <InputAdornment position="end">.mp4</InputAdornment>,
                },
              }}
              onChange={(event) =>
                onDownloadFormChange((current) => ({ ...current, target_file_name: event.target.value }))
              }
            />
            <TextField
              fullWidth
              label="任务文件夹"
              value={downloadForm.folder}
              onChange={(event) => onDownloadFormChange((current) => ({ ...current, folder: event.target.value }))}
            />
            <FormControl fullWidth>
              <InputLabel id="header-preset-label">header 预设</InputLabel>
              <Select
                labelId="header-preset-label"
                label="header 预设"
                value={selectedPresetHost}
                onChange={(event) => onPresetChange(event.target.value)}
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
            <TextField
              fullWidth
              label="并发数"
              type="number"
              value={downloadForm.concurrent}
              onChange={(event) =>
                onDownloadFormChange((current) => ({ ...current, concurrent: Number(event.target.value) }))
              }
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <TextField
              fullWidth
              label="合并重试次数"
              type="number"
              value={downloadForm.combine_retry_count}
              onChange={(event) =>
                onDownloadFormChange((current) => ({ ...current, combine_retry_count: Number(event.target.value) }))
              }
              slotProps={{ htmlInput: { min: 1 } }}
              helperText="合并视频后若时长不符则重试，默认 3 次"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={downloadForm.auto_clear_temp_files}
                  onChange={(event) =>
                    onDownloadFormChange((current) => ({
                      ...current,
                      auto_clear_temp_files: event.target.checked,
                    }))
                  }
                />
              }
              label="自动删除中间文件"
            />
            <Button variant="outlined" onClick={onManageHeaders}>
              前往管理 Header 预设
            </Button>
          </Stack>
        ) : null}
        {page === 'combine' ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {combineUploadError ? <Alert severity="error">{combineUploadError}</Alert> : null}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                fullWidth
                label="文件正则模式"
                value={combineForm.reg_name}
               helperText={combineForm.inputs.length > 0 ? '已选择文件后将优先使用上传列表' : '示例：~/file/path/jepg_(.*).mp4，选择文件后自动生成，也可手动输入'}
               onChange={(event) => onCombineFormChange((current) => ({ ...current, reg_name: event.target.value, inputs: [] }))}
              />
              <Button variant="outlined" component="label" sx={{ mt: 0.5, whiteSpace: 'nowrap', minWidth: 100 }}>
               {combineUploadLoading ? '上传中...' : '选择文件'}
               <input type="file" accept="video/*" multiple hidden onChange={handleCombineFilePick} />
              </Button>
            </Stack>
            {combineUploadSubDir ? (
              <Typography variant="body2" color="text.secondary">
               本次任务上传目录：static/cut/{combineUploadSubDir}
              </Typography>
            ) : null}
            {combineForm.inputs.length > 0 ? (
              <Typography variant="body2" color="text.secondary">
               已选择并上传 {combineForm.inputs.length} 个文件
              </Typography>
            ) : null}
            <TextField
              fullWidth
              label="输出文件名"
              value={combineForm.target_file_name}
              helperText="可选，不填则随机字符串；填写后会自动补全 .mp4"
              slotProps={{
               input: {
                 endAdornment: <InputAdornment position="end">.mp4</InputAdornment>,
               },
              }}
              onChange={(event) =>
               onCombineFormChange((current) => ({ ...current, target_file_name: event.target.value }))
              }
            />
            <TextField
              fullWidth
              label="开始索引"
              type="number"
              value={combineForm.reg_name_start}
              onChange={(event) =>
                onCombineFormChange((current) => ({ ...current, reg_name_start: Number(event.target.value) }))
              }
            />
            <TextField
              fullWidth
              label="结束索引"
              type="number"
              value={combineForm.reg_name_end}
              onChange={(event) =>
                onCombineFormChange((current) => ({ ...current, reg_name_end: Number(event.target.value) }))
              }
            />
            <TextField
              fullWidth
              label="对齐参数索引"
              type="number"
              value={combineForm.same_param_index}
              helperText="-1 表示不对齐；0 表示以第一个视频的码率/音频码率/fps 为准，后续视频转码后再合并，以此类推"
              onChange={(event) =>
                onCombineFormChange((current) => ({ ...current, same_param_index: Number(event.target.value) }))
              }
            />
          </Stack>
        ) : null}
        {page === 'cut' ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="输入文件"
              value={cutForm.input}
              onChange={(event) => onCutFormChange((current) => ({ ...current, input: event.target.value }))}
            />
            <TextField
              fullWidth
              label="开始秒数"
              type="number"
              value={cutForm.start}
              onChange={(event) => onCutFormChange((current) => ({ ...current, start: Number(event.target.value) }))}
            />
            <TextField
              fullWidth
              label="持续时长"
              type="number"
              value={cutForm.duration}
              onChange={(event) => onCutFormChange((current) => ({ ...current, duration: Number(event.target.value) }))}
            />
          </Stack>
        ) : null}
        {page === 'transcode' ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {transcodeError ? <Alert severity="error">{transcodeError}</Alert> : null}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                fullWidth
                label="输入视频文件"
                value={transcodeForm.input}
                onChange={(event) => onTranscodeFormChange((current) => ({ ...current, input: event.target.value }))}
                helperText="支持上传后自动填充，也可手动填写绝对路径"
              />
              <Button variant="outlined" component="label" sx={{ mt: 0.5, whiteSpace: 'nowrap', minWidth: 100 }}>
                {transcodeUploadLoading ? '上传中...' : '上传视频'}
                <input type="file" accept="video/*" hidden onChange={handleTranscodeFilePick} />
              </Button>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="outlined" onClick={() => void handleProbeVideo()} disabled={transcodeProbeLoading}>
                {transcodeProbeLoading ? '分析中...' : '分析视频信息'}
              </Button>
              <Button variant="outlined" onClick={onManageTranscodePresets}>
                管理转码常用设置
              </Button>
            </Stack>
            <FormControl fullWidth>
              <InputLabel id="transcode-preset-label">转码常用设置</InputLabel>
              <Select
                labelId="transcode-preset-label"
                label="转码常用设置"
                value={selectedTranscodePresetTitle}
                onChange={(event) => handleApplyTranscodePreset(event.target.value)}
              >
                <MenuItem value="">不使用预设</MenuItem>
                {transcodePresets.map((preset) => (
                  <MenuItem key={preset.title} value={preset.title}>
                    {preset.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedTranscodePreset ? (
              <Typography variant="body2" color="text.secondary">
                已应用预设：{selectedTranscodePreset.title}
              </Typography>
            ) : null}
            {videoProbeInfo ? (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">视频分析结果（ffprobe）</Typography>
                  <Typography variant="body2">封装格式：{videoProbeInfo.format_name || '--'}</Typography>
                  <Typography variant="body2">时长：{videoProbeInfo.duration_seconds ? `${videoProbeInfo.duration_seconds.toFixed(2)}s` : '--'}</Typography>
                  <Typography variant="body2">视频：{videoProbeInfo.video_codec || '--'} / {videoProbeInfo.width ?? '--'} x {videoProbeInfo.height ?? '--'} / {videoProbeInfo.fps ? `${videoProbeInfo.fps.toFixed(2)}fps` : '--'}</Typography>
                  <Typography variant="body2">视频码率：{videoProbeInfo.video_bitrate ? `${Math.round(videoProbeInfo.video_bitrate / 1000)} kbps` : '--'}</Typography>
                  <Typography variant="body2">音频：{videoProbeInfo.audio_codec || '--'} / {videoProbeInfo.audio_channels ?? '--'} 声道 / {videoProbeInfo.audio_sample_rate ?? '--'} Hz</Typography>
                  <Typography variant="body2">音频码率：{videoProbeInfo.audio_bitrate ? `${Math.round(videoProbeInfo.audio_bitrate / 1000)} kbps` : '--'}</Typography>
                </Stack>
              </Paper>
            ) : null}
            <TextField
              fullWidth
              label="输出文件名"
              value={transcodeForm.target_file_name}
              helperText="可选，不填时自动生成"
              onChange={(event) => onTranscodeFormChange((current) => ({ ...current, target_file_name: event.target.value }))}
            />
            <FormControl fullWidth>
              <InputLabel id="video-codec-label">视频编码</InputLabel>
              <Select
                labelId="video-codec-label"
                label="视频编码"
                value={transcodeForm.video_codec}
                onChange={(event) => onTranscodeFormChange((current) => ({ ...current, video_codec: event.target.value }))}
              >
                <MenuItem value="">跟随原视频</MenuItem>
                <MenuItem value="h264">H.264 (libx264)</MenuItem>
                <MenuItem value="h265">H.265 (libx265)</MenuItem>
                <MenuItem value="copy">拷贝不转码</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="resolution-label">分辨率</InputLabel>
              <Select
                labelId="resolution-label"
                label="分辨率"
                value={transcodeForm.resolution}
                onChange={(event) => onTranscodeFormChange((current) => ({ ...current, resolution: event.target.value }))}
              >
                <MenuItem value="">跟随原视频</MenuItem>
                <MenuItem value="1080p">1080p</MenuItem>
                <MenuItem value="720p">720p</MenuItem>
                <MenuItem value="480p">480p</MenuItem>
                <MenuItem value="360p">360p</MenuItem>
                <MenuItem value="1920x1080">1920x1080</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="视频码率 (kbps)"
              type="number"
              value={transcodeForm.video_bitrate_kbps}
              onChange={(event) => onTranscodeFormChange((current) => ({ ...current, video_bitrate_kbps: Number(event.target.value) }))}
            />
            <TextField
              fullWidth
              label="FPS"
              type="number"
              value={transcodeForm.fps}
              onChange={(event) => onTranscodeFormChange((current) => ({ ...current, fps: Number(event.target.value) }))}
            />
            <FormControl fullWidth>
              <InputLabel id="audio-codec-label">音频编码</InputLabel>
              <Select
                labelId="audio-codec-label"
                label="音频编码"
                value={transcodeForm.audio_codec}
                onChange={(event) => onTranscodeFormChange((current) => ({ ...current, audio_codec: event.target.value }))}
              >
                  <MenuItem value="">跟随原视频</MenuItem>
                <MenuItem value="aac">AAC</MenuItem>
                <MenuItem value="mp3">MP3</MenuItem>
                <MenuItem value="opus">Opus</MenuItem>
                <MenuItem value="copy">拷贝不转码</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="音频码率 (kbps)"
              type="number"
              value={transcodeForm.audio_bitrate_kbps}
              onChange={(event) => onTranscodeFormChange((current) => ({ ...current, audio_bitrate_kbps: Number(event.target.value) }))}
            />
            <TextField
              fullWidth
              label="声道数"
              type="number"
              value={transcodeForm.audio_channels}
              onChange={(event) => onTranscodeFormChange((current) => ({ ...current, audio_channels: Number(event.target.value) }))}
            />
            <TextField
              fullWidth
              label="采样率 (Hz)"
              type="number"
              value={transcodeForm.audio_sample_rate}
              onChange={(event) => onTranscodeFormChange((current) => ({ ...current, audio_sample_rate: Number(event.target.value) }))}
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
        <Button onClick={onClose}>取消</Button>
        {page === 'combine' ? (
          <>
            <Button
              onClick={handleCombineTest}
              variant="outlined"
              disabled={!combineForm.reg_name && combineForm.inputs.length === 0}
            >
              测试
            </Button>
            {combineTested ? (
              <Button onClick={onSubmit} disabled={loading} variant="contained">
                {loading ? '提交中...' : '执行'}
              </Button>
            ) : null}
          </>
        ) : (
          <Button onClick={onSubmit} disabled={loading} variant="contained">
            {loading ? '提交中...' : '执行'}
          </Button>
        )}
      </DialogActions>

      {/* Test preview dialog */}
      <Dialog open={testPreviewOpen} onClose={() => setTestPreviewOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>匹配文件预览</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            根据当前规则将匹配以下文件（共 {testFiles.length} 个）：
          </Typography>
          <List dense>
            {testFiles.map((file, index) => (
              <ListItem key={index}>
                <ListItemText primary={file} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestPreviewOpen(false)}>取消</Button>
          <Button onClick={handleTestConfirm} variant="contained">
            确认，继续保存
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}

export default CreateTaskDialog

function generateRandomString(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function generateRandomFileName(length: number) {
  return generateRandomString(length)
}
