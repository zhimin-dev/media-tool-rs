import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

function CombinePage(props: TaskListPageProps) {
  return <TaskListPage {...props} createButtonLabel="新建合并任务" />
}

export default CombinePage
