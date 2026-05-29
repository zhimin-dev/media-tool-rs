export type TaskPage = 'download' | 'combine' | 'cut'
export type AppPage = TaskPage | 'headers' | 'watch'

export const appPages: Array<{ key: AppPage; label: string; path: string }> = [
  { key: 'download', label: '下载', path: '/download' },
  { key: 'combine', label: '合并', path: '/combine' },
  { key: 'cut', label: '截取', path: '/cut' },
  { key: 'headers', label: 'Header 预设', path: '/headers' },
  { key: 'watch', label: '播放', path: '/watch' },
]

export const pageLabelMap: Record<AppPage, string> = Object.fromEntries(
  appPages.map((page) => [page.key, page.label]),
) as Record<AppPage, string>

export function isTaskPage(page: AppPage): page is TaskPage {
  return page === 'download' || page === 'combine' || page === 'cut'
}

export function getPageFromPath(pathname: string): AppPage {
  const matched = appPages.find((page) => pathname === page.path)
  return matched?.key ?? 'download'
}

export function getPathForPage(page: AppPage) {
  return appPages.find((item) => item.key === page)?.path ?? '/download'
}
