import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import videojs from 'video.js'
import '@videojs/http-streaming'
import 'video.js/dist/video-js.css'

type M3u8PlayerProps = {
  url: string
  headers?: Record<string, string>
}

function isM3u8Url(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.pathname.toLowerCase().includes('.m3u8')
  } catch {
    return false
  }
}

function M3u8Player({ url, headers = {} }: M3u8PlayerProps) {
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const requestHookRef = useRef<((options: VideoJsRequestOptions) => VideoJsRequestOptions) | null>(null)
  const [error, setError] = useState<string>('')
  const preferNativeHls = useMemo(() => preferNativeHlsPlayback(), [])
  const [useNativeHls, setUseNativeHls] = useState(preferNativeHls)
  const [triedDecodeFallback, setTriedDecodeFallback] = useState(false)
  const sanitizedUrl = useMemo(() => sanitizeVideoUrl(url), [url])
  const [isPlaying, setIsPlaying] = useState(false)
  const playbackModeLabel = useMemo(() => (useNativeHls ? 'Native HLS' : 'VHS (MSE)'), [useNativeHls])
  const helperMessage = useMemo(() => {
    if (!url) {
      return ''
    }
    if (!sanitizedUrl) {
      return '仅支持 http/https 链接'
    }
    return error
  }, [error, sanitizedUrl, url])

  useEffect(() => {
    const host = playerHostRef.current
    if (!host || playerRef.current) {
      return
    }

    const videoElement = document.createElement('video-js')
    videoElement.classList.add('vjs-big-play-centered')
    host.appendChild(videoElement)

    const player = videojs(videoElement, {
      autoplay: true,
      controls: true,
      responsive: true,
      fluid: true,
      muted: true,
      playsinline: true,
      html5: {
        vhs: {
          overrideNative: !useNativeHls,
        },
      },
    })
    playerRef.current = player

    const syncPlayingState = () => {
      setIsPlaying(!player.paused())
    }
    const handleError = () => {
      setError(player.error()?.message ?? '播放器加载失败，请检查链接是否可访问')
    }

    player.on('play', syncPlayingState)
    player.on('pause', syncPlayingState)
    player.on('ended', syncPlayingState)
    player.on('error', handleError)

    return () => {
      player.off('play', syncPlayingState)
      player.off('pause', syncPlayingState)
      player.off('ended', syncPlayingState)
      player.off('error', handleError)
      player.dispose()
      playerRef.current = null
      requestHookRef.current = null
      host.innerHTML = ''
    }
  }, [useNativeHls])

  useEffect(() => {
    setUseNativeHls(preferNativeHls)
    setTriedDecodeFallback(false)
  }, [preferNativeHls, sanitizedUrl])

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    const removeRequestHook = () => {
      const vhsXhr = getVhsXhr(player)
      if (requestHookRef.current && vhsXhr?.offRequest) {
        vhsXhr.offRequest(requestHookRef.current)
      }
      requestHookRef.current = null
    }

    setError('')
    setIsPlaying(false)
    player.pause()
    removeRequestHook()

    const hasHeaders = Object.keys(headers).length > 0
    const handleXhrHooksReady = () => {
      if (!hasHeaders || !isM3u8Url(sanitizedUrl)) {
        return
      }

      const hook = (options: VideoJsRequestOptions) => {
        const beforeSend = options.beforeSend
        options.beforeSend = (xhr) => {
          beforeSend?.(xhr)
          for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value)
          }
        }
        return options
      }

      const vhsXhr = getVhsXhr(player)
      if (!vhsXhr?.onRequest) {
        return
      }

      requestHookRef.current = hook
      vhsXhr.onRequest(hook)
    }

    player.one('xhr-hooks-ready', handleXhrHooksReady)

    const handleLoadedMetadata = () => {
      if (!isM3u8Url(sanitizedUrl) || triedDecodeFallback) {
        return
      }

      const video = player.el()?.querySelector('video, .vjs-tech') as HTMLVideoElement | null
      if (!video) {
        return
      }

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        return
      }

      setTriedDecodeFallback(true)
      setUseNativeHls((prev) => !prev)
      setError(`检测到仅音频输出，已自动切换解码模式重试（当前模式：${playbackModeLabel}）`)
    }

    player.one('loadedmetadata', handleLoadedMetadata)

    if (!sanitizedUrl) {
      player.src({ src: '' })
      return () => {
        player.off('xhr-hooks-ready', handleXhrHooksReady)
        player.off('loadedmetadata', handleLoadedMetadata)
        removeRequestHook()
      }
    }

    player.src({
      src: sanitizedUrl,
      type: getVideoSourceType(sanitizedUrl),
    })

    return () => {
      player.off('xhr-hooks-ready', handleXhrHooksReady)
      player.off('loadedmetadata', handleLoadedMetadata)
      removeRequestHook()
    }
  }, [headers, playbackModeLabel, sanitizedUrl, triedDecodeFallback])

  const handlePlay = async () => {
    const player = playerRef.current
    if (!player) {
      return
    }
    try {
      await player.play()
      setIsPlaying(true)
    } catch {
      setError('播放失败，请检查链接是否可访问')
    }
  }

  const handlePause = () => {
    const player = playerRef.current
    if (!player) {
      return
    }
    player.pause()
    setIsPlaying(false)
  }

  const handlePiP = async () => {
    const video = playerRef.current?.el()?.querySelector('video, .vjs-tech') as HTMLVideoElement | null
    if (!video) {
      return
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if ('requestPictureInPicture' in video) {
        await video.requestPictureInPicture()
      }
    } catch {
      setError('当前设备不支持小窗播放')
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        在线播放
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        使用 video.js 在线播放 m3u8 链接或本地视频，可用于任务创建前预览。
      </Typography>
      {helperMessage ? <Alert sx={{ mb: 2 }}>{helperMessage}</Alert> : null}
      {sanitizedUrl ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          当前解码模式: {playbackModeLabel}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button variant="contained" size="small" onClick={handlePlay} disabled={!sanitizedUrl}>
          播放
        </Button>
        <Button variant="outlined" size="small" onClick={handlePause} disabled={!isPlaying}>
          暂停
        </Button>
        <Button variant="outlined" size="small" onClick={handlePiP} disabled={!sanitizedUrl}>
          小窗播放
        </Button>
      </Stack>
      <Box
        sx={{
          backgroundColor: '#000',
          borderRadius: 2,
          overflow: 'hidden',
          minHeight: 400,
          '& .video-js': {
            width: '100%',
            minHeight: 400,
          },
          '& .video-js .vjs-tech': {
            width: '100%',
            height: '100%',
          },
        }}
      >
        <div data-vjs-player>
          <div ref={playerHostRef} />
        </div>
      </Box>
    </Paper>
  )
}

export default M3u8Player

function sanitizeVideoUrl(value: string) {
  if (!value.trim()) {
    return ''
  }

  if (value.startsWith('/')) {
    return value
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return ''
  }

  return ''
}

function getVideoSourceType(url: string) {
  return isM3u8Url(url) ? 'application/x-mpegURL' : 'video/mp4'
}

function preferNativeHlsPlayback() {
  const ua = window.navigator.userAgent
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua)
  const isIos = /iPad|iPhone|iPod/i.test(ua)
  return isSafari || isIos
}

type VideoJsRequestOptions = {
  beforeSend?: (xhr: XMLHttpRequest) => void
}

function getVhsXhr(player: ReturnType<typeof videojs>) {
  const tech = player.tech(true) as {
    vhs?: {
      xhr?: {
        onRequest?: (callback: (options: VideoJsRequestOptions) => VideoJsRequestOptions) => void
        offRequest?: (callback: (options: VideoJsRequestOptions) => VideoJsRequestOptions) => void
      }
    }
  } | null

  return tech?.vhs?.xhr
}
