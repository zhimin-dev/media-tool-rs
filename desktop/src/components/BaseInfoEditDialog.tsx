import type { Dispatch, SetStateAction } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from '@mui/material'
import type { BaseInfo } from '../types'

type BaseInfoEditDialogProps = {
  open: boolean
  baseInfoForm: BaseInfo
  baseInfoHeaderText: string
  commandPreview: string
  onClose: () => void
  onBaseInfoFormChange: Dispatch<SetStateAction<BaseInfo>>
  onBaseInfoHeaderTextChange: (value: string) => void
  onSave: () => void
}

function BaseInfoEditDialog({
  open,
  baseInfoForm,
  baseInfoHeaderText,
  commandPreview,
  onClose,
  onBaseInfoFormChange,
  onBaseInfoHeaderTextChange,
  onSave,
}: BaseInfoEditDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>编辑失败任务 base_info.json</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            fullWidth
            label="m3u8 链接 URL"
            value={baseInfoForm.url}
            onChange={(event) =>
              onBaseInfoFormChange((current) => ({
                ...current,
                url: event.target.value,
              }))
            }
          />
          <TextField
            fullWidth
            label="m3u8 文件名（可选）"
            value={baseInfoForm.m3u8_name}
            onChange={(event) =>
              onBaseInfoFormChange((current) => ({
                ...current,
                m3u8_name: event.target.value,
              }))
            }
          />
          <TextField
            fullWidth
            label="输出文件名"
            value={baseInfoForm.target_file_name}
            onChange={(event) =>
              onBaseInfoFormChange((current) => ({
                ...current,
                target_file_name: event.target.value,
              }))
            }
          />
          <TextField
            fullWidth
            label="并发数"
            type="number"
            value={baseInfoForm.concurrent}
            onChange={(event) =>
              onBaseInfoFormChange((current) => ({
                ...current,
                concurrent: Number(event.target.value),
              }))
            }
          />
          <TextField
            fullWidth
            label="合并重试次数"
            type="number"
            value={baseInfoForm.combine_retry_count}
            onChange={(event) =>
              onBaseInfoFormChange((current) => ({
                ...current,
                combine_retry_count: Number(event.target.value),
              }))
            }
            helperText="合并视频后若时长不符则重试，默认 3 次"
          />
          <TextField
            fullWidth
            label="Header JSON"
            value={baseInfoHeaderText}
            onChange={(event) => onBaseInfoHeaderTextChange(event.target.value)}
            multiline
            minRows={6}
          />
          <Typography variant="subtitle2" gutterBottom>
            命令预览
          </Typography>
          <Paper variant="outlined" sx={{ p: 1.5, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {commandPreview}
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={onSave}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default BaseInfoEditDialog
