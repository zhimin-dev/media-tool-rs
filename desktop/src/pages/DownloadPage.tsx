import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

type DownloadPageProps = Omit<TaskListPageProps, 'createButtonLabel'>

function DownloadPage(props: DownloadPageProps) {
  return <TaskListPage {...props} createButtonLabel="新建下载任务" />
}

export default DownloadPage
