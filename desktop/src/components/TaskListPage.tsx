import { Alert, Button, Card, CardContent, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material'
import type { TaskRecord, TaskStatus } from '../types'

const statusLabelMap: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  success: '成功',
  failed: '失败',
}

const statusColorMap: Record<TaskStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  queued: 'warning',
  running: 'primary',
  success: 'success',
  failed: 'error',
}

export type TaskListPageProps = {
  createButtonLabel: string
  tasks: TaskRecord[]
  refreshInterval: number
  baseInfoEditLoading: boolean
  onCreate: () => void
  onRefresh: () => void
  onRefreshIntervalChange: (value: number) => void
  onView: (taskId: number) => void
  onRetry: (taskId: number) => void
  onDelete: (taskId: number) => void
  onOpenVideo?: (task: TaskRecord) => void
  onEditFailedTask?: (taskId: number) => void
}

function TaskListPage({
  createButtonLabel,
  tasks,
  refreshInterval,
  baseInfoEditLoading,
  onCreate,
  onRefresh,
  onRefreshIntervalChange,
  onView,
  onRetry,
  onDelete,
  onOpenVideo,
  onEditFailedTask,
}: TaskListPageProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 2 }}
      >
        <Typography variant="h6">任务列表</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button variant="contained" size="small" onClick={onCreate}>
            {createButtonLabel}
          </Button>
          <Button variant="outlined" size="small" onClick={onRefresh}>
            手动刷新
          </Button>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="refresh-interval-label">刷新间隔</InputLabel>
            <Select
              labelId="refresh-interval-label"
              label="刷新间隔"
              value={refreshInterval}
              onChange={(event) => onRefreshIntervalChange(Number(event.target.value))}
            >
              <MenuItem value={3000}>3 秒</MenuItem>
              <MenuItem value={5000}>5 秒</MenuItem>
              <MenuItem value={10000}>10 秒</MenuItem>
              <MenuItem value={30000}>30 秒</MenuItem>
              <MenuItem value={60000}>60 秒</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Stack>
      <Stack spacing={2}>
        {tasks.length === 0 ? (
          <Alert severity="info">暂无任务</Alert>
        ) : (
          tasks.map((task) => (
            <Card key={task.id} variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="subtitle1">
                      {task.payload.kind === 'download' && task.payload.folder ? task.payload.folder : task.title}
                    </Typography>
                    <Chip size="small" label={statusLabelMap[task.status]} color={statusColorMap[task.status]} />
                  </Stack>
                  {task.payload.kind === 'download' && task.payload.target_file_name ? (
                    <Typography variant="body2" color="text.secondary">
                      {task.payload.target_file_name}
                    </Typography>
                  ) : null}
                  <Typography variant="body2" color="text.secondary">
                    {task.message ?? '等待结果'}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button variant="outlined" size="small" onClick={() => onView(task.id)}>
                      查看
                    </Button>
                    {task.payload.kind === 'download' && task.status === 'success' && task.result_path && onOpenVideo ? (
                      <Button variant="outlined" size="small" onClick={() => onOpenVideo(task)}>
                        打开播放
                      </Button>
                    ) : null}
                    {(task.payload.kind === 'combine' || task.payload.kind === 'cut') && task.status === 'success' && task.result_path && onOpenVideo ? (
                      <Button variant="outlined" size="small" onClick={() => onOpenVideo(task)}>
                        打开播放
                      </Button>
                    ) : null}
                    {task.payload.kind === 'download' && task.status === 'failed' && onEditFailedTask ? (
                      <Button
                        variant="outlined"
                        size="small"
                        disabled={baseInfoEditLoading}
                        onClick={() => onEditFailedTask(task.id)}
                      >
                        编辑失败任务
                      </Button>
                    ) : null}
                    <Button variant="outlined" size="small" onClick={() => onRetry(task.id)}>
                      重试
                    </Button>
                    <Button color="error" variant="outlined" size="small" onClick={() => onDelete(task.id)}>
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
  )
}

export default TaskListPage
