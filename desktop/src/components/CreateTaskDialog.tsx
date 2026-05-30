import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputAdornment, InputLabel, List, ListItem, ListItemText, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import type { TaskPage } from '../appPages'
import { uploadVideo } from '../api'
import type { CombinePayload, CutPayload, DownloadPayload, HeaderPreset } from '../types'

type CreateTaskDialogProps = {
  open: boolean
  page: TaskPage
  createTitle: string
  commandPreview: string
  loading: boolean
  downloadForm: DownloadPayload
  combineForm: CombinePayload
  cutForm: CutPayload
  headerPresets: HeaderPreset[]
  selectedPresetHost: string
  selectedPreset: HeaderPreset | null
  matchedPresetHost: string
  onPresetChange: (host: string) => void
  onDownloadFormChange: Dispatch<SetStateAction<DownloadPayload>>
  onCombineFormChange: Dispatch<SetStateAction<CombinePayload>>
  onCutFormChange: Dispatch<SetStateAction<CutPayload>>
  onClose: () => void
  onManageHeaders: () => void
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
  headerPresets,
  selectedPresetHost,
  selectedPreset,
  matchedPresetHost,
  onPresetChange,
  onDownloadFormChange,
  onCombineFormChange,
  onCutFormChange,
  onClose,
  onManageHeaders,
  onSubmit,
}: CreateTaskDialogProps) {
  const [testedKey, setTestedKey] = useState<string | null>(null)
  const [testPreviewOpen, setTestPreviewOpen] = useState(false)
  const [testFiles, setTestFiles] = useState<string[]>([])
  const [combineUploadLoading, setCombineUploadLoading] = useState(false)
  const [combineUploadError, setCombineUploadError] = useState('')
  const [combineUploadSubDir, setCombineUploadSubDir] = useState('')

  // Derive tested: true only when the snapshot matches the current form values
  const formKey = [
    combineForm.reg_name,
    combineForm.reg_name_start,
    combineForm.reg_name_end,
    combineForm.inputs.join('|'),
  ].join('|')
  const combineTested = testedKey !== null && testedKey === formKey

  useEffect(() => {
    if (!open || page !== 'combine') return
    setTestedKey(null)
    setTestPreviewOpen(false)
    setTestFiles([])
    setCombineUploadError('')
    setCombineUploadSubDir(`combine/${generateRandomString(12)}`)
  }, [open, page])

  const handleCombineFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    event.target.value = ''
    setCombineUploadLoading(true)
    setCombineUploadError('')
    try {
      const subDir = combineUploadSubDir || `combine/${generateRandomString(12)}`
      if (!combineUploadSubDir) {
        setCombineUploadSubDir(subDir)
      }
      const uploadedFiles = await Promise.all(
        files.map((file) =>
          uploadVideo(file, {
            subDir,
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
               本次任务上传目录：static/uploads/{combineUploadSubDir}
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
