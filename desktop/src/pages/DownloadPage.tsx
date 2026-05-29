import TaskListPage, { type TaskListPageProps } from '../components/TaskListPage'

function DownloadPage(props: TaskListPageProps) {
  return <TaskListPage {...props} createButtonLabel="新建下载任务" />
}

export default DownloadPage
