import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, Stack, Typography } from '@mui/material'
import type { TaskDetail, TaskRecord } from '../types'

type TaskDetailDialogProps = {
  open: boolean
  loading: boolean
  detail: TaskDetail | null
  onClose: () => void
  onOpenVideo: (task: TaskRecord) => void
}

function TaskDetailDialog({ open, loading, detail, onClose, onOpenVideo }: TaskDetailDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>任务详情</DialogTitle>
      <DialogContent>
        {loading ? (
          <Typography>加载中...</Typography>
        ) : detail ? (
          <Stack spacing={1}>
            <Typography variant="body2">任务：{detail.task.title}</Typography>
            <Typography variant="body2">命令：{detail.task.command_preview}</Typography>
            <Typography variant="body2">输出目录：{detail.output_dir ?? '--'}</Typography>
            {detail.task.payload.kind === 'download' && detail.task.status === 'success' && detail.task.result_path ? (
              <Box>
                <Button size="small" variant="outlined" onClick={() => onOpenVideo(detail.task)}>
                  打开播放
                </Button>
              </Box>
            ) : null}
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
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}

export default TaskDetailDialog
