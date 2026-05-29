import { Alert, Button, Card, CardContent, Paper, Stack, TextField, Typography } from '@mui/material'
import HeaderRowFields from '../components/HeaderRowFields'
import type { HeaderPreset, HeaderRow } from '../types'

type HeaderPresetsPageProps = {
  headerPresets: HeaderPreset[]
  editingPresetHost: string
  presetFormHost: string
  presetFormRows: HeaderRow[]
  matchedPresetHost: string
  onPresetFormHostChange: (value: string) => void
  onPresetHeaderChange: (index: number, field: keyof HeaderRow, value: string) => void
  onAddPresetHeader: () => void
  onRemovePresetHeader: (index: number) => void
  onResetPresetForm: () => void
  onSavePreset: () => void
  onEditPreset: (preset: HeaderPreset) => void
  onDeletePreset: (host: string) => void
}

function HeaderPresetsPage({
  headerPresets,
  editingPresetHost,
  presetFormHost,
  presetFormRows,
  matchedPresetHost,
  onPresetFormHostChange,
  onPresetHeaderChange,
  onAddPresetHeader,
  onRemovePresetHeader,
  onResetPresetForm,
  onSavePreset,
  onEditPreset,
  onDeletePreset,
}: HeaderPresetsPageProps) {
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
            <Typography variant="h6">Header 预设列表</Typography>
            <Button variant="outlined" onClick={onResetPresetForm}>
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
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">{editingPresetHost ? '编辑预设' : '新建预设'}</Typography>
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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="contained" onClick={onSavePreset}>
              保存预设
            </Button>
            <Button variant="outlined" onClick={onResetPresetForm}>
              重置
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  )
}

export default HeaderPresetsPage
