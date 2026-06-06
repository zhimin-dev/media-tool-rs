import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMemo } from 'react'
import type { ApiConnectionStatus } from '../api'
import HeaderRowFields from '../components/HeaderRowFields'
import type { HeaderPreset, HeaderRow, TranscodePreset } from '../types'

type HeaderPresetsPageProps = {
  apiStatus: ApiConnectionStatus
  appVersion: string
  headerPresets: HeaderPreset[]
  presetDialogOpen: boolean
  editingPresetHost: string
  presetFormHost: string
  presetFormRows: HeaderRow[]
  matchedPresetHost: string
  onOpenNewPreset: () => void
  onClosePresetDialog: () => void
  onPresetFormHostChange: (value: string) => void
  onPresetHeaderChange: (index: number, field: keyof HeaderRow, value: string) => void
  onAddPresetHeader: () => void
  onRemovePresetHeader: (index: number) => void
  onResetPresetForm: () => void
  onSavePreset: () => void
  onEditPreset: (preset: HeaderPreset) => void
  onDeletePreset: (host: string) => void
  transcodePresets: TranscodePreset[]
  transcodePresetDialogOpen: boolean
  editingTranscodePresetTitle: string
  transcodePresetForm: TranscodePreset
  onOpenNewTranscodePreset: () => void
  onCloseTranscodePresetDialog: () => void
  onTranscodePresetFormChange: (key: keyof TranscodePreset, value: string | number) => void
  onSaveTranscodePreset: () => void
  onEditTranscodePreset: (preset: TranscodePreset) => void
  onDeleteTranscodePreset: (title: string) => void
}

function HeaderPresetsPage({
  apiStatus,
  appVersion,
  headerPresets,
  presetDialogOpen,
  editingPresetHost,
  presetFormHost,
  presetFormRows,
  matchedPresetHost,
  onOpenNewPreset,
  onClosePresetDialog,
  onPresetFormHostChange,
  onPresetHeaderChange,
  onAddPresetHeader,
  onRemovePresetHeader,
  onResetPresetForm,
  onSavePreset,
  onEditPreset,
  onDeletePreset,
  transcodePresets,
  transcodePresetDialogOpen,
  editingTranscodePresetTitle,
  transcodePresetForm,
  onOpenNewTranscodePreset,
  onCloseTranscodePresetDialog,
  onTranscodePresetFormChange,
  onSaveTranscodePreset,
  onEditTranscodePreset,
  onDeleteTranscodePreset,
}: HeaderPresetsPageProps) {
  const apiHost = useMemo(() => apiStatus.apiBase.replace(/\/api\/?$/, ''), [apiStatus.apiBase])

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">设置</Typography>
          <Stack spacing={2}>
            <Alert severity={apiStatus.healthy ? 'success' : 'warning'}>
              {apiStatus.healthy ? '后端接口连接正常' : '后端接口连接异常'}
            </Alert>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                App 版本
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                {appVersion}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                当前 API Host
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {apiHost}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                连接信息
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {apiStatus.message}
              </Typography>
            </Box>
          </Stack>

          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
              <Typography variant="h6">Header 预设列表</Typography>
              <Button variant="outlined" onClick={onOpenNewPreset}>
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
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {JSON.stringify(preset.headers)}
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button variant="outlined" size="small" onClick={() => onEditPreset(preset)}>
                            编辑
                          </Button>
                          <Button color="error" variant="outlined" size="small" onClick={() => onDeletePreset(preset.host)}>
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

          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
              <Typography variant="h6">转码常用设置</Typography>
              <Button variant="outlined" onClick={onOpenNewTranscodePreset}>
                新建转码预设
              </Button>
            </Stack>
            {transcodePresets.length === 0 ? (
              <Alert severity="info">暂无转码预设</Alert>
            ) : (
              <Stack spacing={1}>
                {transcodePresets.map((preset) => (
                  <Card key={preset.title} variant="outlined">
                    <CardContent>
                      <Stack spacing={1}>
                        <Typography variant="subtitle1">{preset.title}</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {`video=${preset.video_codec}, resolution=${preset.resolution || '--'}, vb=${preset.video_bitrate_kbps || 0}kbps, fps=${preset.fps || 0}, audio=${preset.audio_codec}, ab=${preset.audio_bitrate_kbps || 0}kbps, ch=${preset.audio_channels || 0}, ar=${preset.audio_sample_rate || 0}`}
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button variant="outlined" size="small" onClick={() => onEditTranscodePreset(preset)}>
                            编辑
                          </Button>
                          <Button color="error" variant="outlined" size="small" onClick={() => onDeleteTranscodePreset(preset.title)}>
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
        </Stack>
      </Paper>
      <Dialog open={presetDialogOpen} onClose={onClosePresetDialog} fullWidth maxWidth="sm">
        <DialogTitle>{editingPresetHost ? '编辑预设' : '新建预设'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="预设 Host"
              placeholder="例如 surrit.com"
              value={presetFormHost}
              onChange={(event) => onPresetFormHostChange(event.target.value)}
              helperText={matchedPresetHost ? `当前下载链接 host：${matchedPresetHost}` : undefined}
            />
            <HeaderRowFields
              rows={presetFormRows}
              title="Header 列表"
              keyLabel="Header 名称"
              valueLabel="Header 值"
              addLabel="添加 Header"
              onChange={onPresetHeaderChange}
              onAdd={onAddPresetHeader}
              onRemove={onRemovePresetHeader}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={() => {
              onResetPresetForm()
              onClosePresetDialog()
            }}
          >
            取消
          </Button>
          <Button variant="contained" onClick={onSavePreset}>
            保存预设
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={transcodePresetDialogOpen} onClose={onCloseTranscodePresetDialog} fullWidth maxWidth="sm">
        <DialogTitle>{editingTranscodePresetTitle ? '编辑转码预设' : '新建转码预设'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="预设标题"
              value={transcodePresetForm.title}
              onChange={(event) => onTranscodePresetFormChange('title', event.target.value)}
            />
            <TextField
              fullWidth
              label="视频编码"
              value={transcodePresetForm.video_codec}
              onChange={(event) => onTranscodePresetFormChange('video_codec', event.target.value)}
              helperText="留空表示跟随原视频；也可填写 h264 / h265 / copy"
            />
            <TextField
              fullWidth
              label="分辨率"
              value={transcodePresetForm.resolution}
              placeholder="例如 1080p、720p、1920x1080"
              onChange={(event) => onTranscodePresetFormChange('resolution', event.target.value)}
              helperText="留空表示跟随原视频；1080p/720p 会自动按源视频横竖方向缩放"
            />
            <TextField
              fullWidth
              label="视频码率 (kbps)"
              type="number"
              value={transcodePresetForm.video_bitrate_kbps}
              onChange={(event) => onTranscodePresetFormChange('video_bitrate_kbps', Number(event.target.value))}
            />
            <TextField
              fullWidth
              label="FPS"
              type="number"
              value={transcodePresetForm.fps}
              onChange={(event) => onTranscodePresetFormChange('fps', Number(event.target.value))}
            />
            <TextField
              fullWidth
              label="音频编码"
              value={transcodePresetForm.audio_codec}
              onChange={(event) => onTranscodePresetFormChange('audio_codec', event.target.value)}
              helperText="留空表示跟随原视频；也可填写 aac / mp3 / opus / copy"
            />
            <TextField
              fullWidth
              label="音频码率 (kbps)"
              type="number"
              value={transcodePresetForm.audio_bitrate_kbps}
              onChange={(event) => onTranscodePresetFormChange('audio_bitrate_kbps', Number(event.target.value))}
            />
            <TextField
              fullWidth
              label="声道数"
              type="number"
              value={transcodePresetForm.audio_channels}
              onChange={(event) => onTranscodePresetFormChange('audio_channels', Number(event.target.value))}
            />
            <TextField
              fullWidth
              label="采样率 (Hz)"
              type="number"
              value={transcodePresetForm.audio_sample_rate}
              onChange={(event) => onTranscodePresetFormChange('audio_sample_rate', Number(event.target.value))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={onCloseTranscodePresetDialog}>
            取消
          </Button>
          <Button variant="contained" onClick={onSaveTranscodePreset}>
            保存预设
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default HeaderPresetsPage
