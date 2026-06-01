import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemButton, Stack, Typography } from '@mui/material'
import type { TaskDetail, TaskRecord } from '../types'

type TaskDetailDialogProps = {
  open: boolean
  loading: boolean
  detail: TaskDetail | null
  onClose: () => void
  onOpenVideo: (task: TaskRecord) => void
}

function TaskDetailDialog({ open, loading, detail, onClose, onOpenVideo }: TaskDetailDialogProps) {
  const isCutTask = detail?.task.payload.kind === 'cut' || detail?.task.payload.kind === 'cut_batch'

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
            {!isCutTask ? (
              <Typography variant="body2">输出目录：{detail.output_dir ?? '--'}</Typography>
            ) : null}
            {detail.task.payload.kind === 'download' && detail.task.status === 'success' && detail.task.result_path ? (
              <Box>
                <Button size="small" variant="outlined" onClick={() => onOpenVideo(detail.task)}>
                  打开播放
                </Button>
              </Box>
            ) : null}
            {detail.task.payload.kind === 'combine' && detail.task.status === 'success' && detail.task.result_path ? (
              <Box>
                <Button size="small" variant="outlined" onClick={() => onOpenVideo(detail.task)}>
                  打开播放
                </Button>
              </Box>
            ) : null}
            {detail.child_tasks.length > 0 ? (
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">子任务：</Typography>
                {detail.child_tasks.length > 0 ? (
                  <List dense>
                    {detail.child_tasks.map((childTask, index) => (
                      <ListItem key={childTask.id} disablePadding>
                        <ListItemButton disabled={!childTask.result_path} onClick={() => onOpenVideo(childTask)}>
                          <Stack spacing={0.5}>
                            <Typography variant="body2">
                              {index + 1}. {childTask.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {childTask.message ?? '等待结果'}
                            </Typography>
                            {childTask.result_path ? (
                              <Typography variant="body2" color="primary">
                                {childTask.result_path.split('/').pop() ?? childTask.result_path} （点击播放）
                              </Typography>
                            ) : null}
                          </Stack>
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">暂无截取文件</Typography>
                )}
              </Stack>
            ) : isCutTask ? (
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">截取视频文件：</Typography>
                {detail.task.result_path ? (
                  <List dense>
                    <ListItem disablePadding>
                      <ListItemButton onClick={() => onOpenVideo(detail.task)}>
                        <Typography variant="body2" color="primary">
                          {detail.task.result_path.split('/').pop() ?? detail.task.result_path} （点击播放）
                        </Typography>
                      </ListItemButton>
                    </ListItem>
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">暂无截取文件</Typography>
                )}
              </Stack>
            ) : (
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">目录内容：</Typography>
                <List dense>
                  {detail.output_files.length === 0 ? (
                    <ListItem>暂无文件</ListItem>
                  ) : (
                    detail.output_files.map((file) => <ListItem key={file}>{file}</ListItem>)
                  )}
                </List>
              </Stack>
            )}
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
