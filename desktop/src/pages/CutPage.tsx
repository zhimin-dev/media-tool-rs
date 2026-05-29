import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

type CutPageProps = Omit<TaskListPageProps, 'createButtonLabel'>

function CutPage(props: CutPageProps) {
  return <TaskListPage {...props} createButtonLabel="新建截取任务" />
}

export default CutPage
