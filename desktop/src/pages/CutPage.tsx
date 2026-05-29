import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

function CutPage(props: TaskListPageProps) {
  return <TaskListPage {...props} createButtonLabel="新建截取任务" />
}

export default CutPage
