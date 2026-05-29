import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

type CombinePageProps = Omit<TaskListPageProps, 'createButtonLabel'>

function CombinePage(props: CombinePageProps) {
  return <TaskListPage {...props} createButtonLabel="新建合并任务" />
}

export default CombinePage
