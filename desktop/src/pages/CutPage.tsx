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

type CutPageProps = {
  tasks: TaskRecord[]
  refreshInterval: number
  baseInfoEditLoading: boolean
  onCreate: () => void
  onRefresh: () => void
  onRefreshIntervalChange: (value: number) => void
  onView: (taskId: number) => void
  onRetry: (taskId: number) => void
  onDelete: (taskId: number) => void
  onOpenVideo: (task: TaskRecord) => void
}

function CutPage({
  tasks,
  refreshInterval,
  onCreate,
  onRefresh,
  onRefreshIntervalChange,
  onView,
  onRetry,
  onDelete,
  onOpenVideo,
}: CutPageProps) {
  const parentTasks = tasks.filter((task) => task.parent_id === null)

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
            新建截取任务
          </Button>
          <Button variant="outlined" size="small" onClick={onRefresh}>
            手动刷新
          </Button>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="cut-refresh-interval-label">刷新间隔</InputLabel>
            <Select
              labelId="cut-refresh-interval-label"
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
        {parentTasks.length === 0 ? (
          <Alert severity="info">暂无任务</Alert>
        ) : (
          parentTasks.map((task) => {
            const childTasks = tasks.filter((item) => item.parent_id === task.id)

            return (
              <Card key={task.id} variant="outlined">
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="subtitle1">{task.title}</Typography>
                      <Chip size="small" label={statusLabelMap[task.status]} color={statusColorMap[task.status]} />
                      {childTasks.length > 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          子任务 {childTasks.length} 个
                        </Typography>
                      ) : null}
                    </Stack>

                    <Typography variant="body2" color="text.secondary">
                      {task.message ?? '等待结果'}
                    </Typography>

                    {childTasks.length > 0 ? (
                      <Stack spacing={1} sx={{ pl: 1, borderLeft: 1, borderColor: 'divider' }}>
                        {childTasks.map((childTask, index) => (
                          <Stack
                            key={childTask.id}
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                          >
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                              <Typography variant="body2">
                                {index + 1}. {formatCutTaskTitle(childTask)}
                              </Typography>
                              <Chip
                                size="small"
                                label={statusLabelMap[childTask.status]}
                                color={statusColorMap[childTask.status]}
                              />
                            </Stack>
                            {childTask.status === 'success' && childTask.result_path ? (
                              <Button variant="outlined" size="small" onClick={() => onOpenVideo(childTask)}>
                                播放
                              </Button>
                            ) : null}
                          </Stack>
                        ))}
                      </Stack>
                    ) : task.status === 'success' && task.result_path ? (
                      <Button variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => onOpenVideo(task)}>
                        打开播放
                      </Button>
                    ) : null}

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button variant="outlined" size="small" onClick={() => onView(task.id)}>
                        查看
                      </Button>
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
            )
          })
        )}
      </Stack>
    </Paper>
  )
}

function formatCutTaskTitle(task: TaskRecord) {
  if (task.payload.kind !== 'cut') {
    return task.title
  }
  return task.payload.target_file_name || `${task.payload.start}s - ${task.payload.start + task.payload.duration}s`
}

export default CutPage
