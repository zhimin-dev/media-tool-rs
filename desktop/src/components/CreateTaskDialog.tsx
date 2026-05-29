import type { Dispatch, SetStateAction } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import type { TaskPage } from '../appPages'
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
            <TextField
              fullWidth
              label="文件正则模式"
              value={combineForm.reg_name}
              onChange={(event) => onCombineFormChange((current) => ({ ...current, reg_name: event.target.value }))}
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
        <Button onClick={onSubmit} disabled={loading} variant="contained">
          {loading ? '提交中...' : '执行'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CreateTaskDialog
