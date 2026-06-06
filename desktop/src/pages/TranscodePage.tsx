import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

type TranscodePageProps = Omit<TaskListPageProps, 'createButtonLabel'>

function TranscodePage(props: TranscodePageProps) {
  return <TaskListPage {...props} createButtonLabel="新建转码任务" />
}

export default TranscodePage
