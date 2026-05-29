import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import Hls from 'hls.js'
import { useEffect, useMemo, useRef, useState } from 'react'

type M3u8PlayerProps = {
  url: string
}

function M3u8Player({ url }: M3u8PlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string>('')
  const sanitizedUrl = useMemo(() => sanitizeM3u8Url(url), [url])
  const supportsNativeHls = useMemo(() => {
    const video = document.createElement('video')
    return Boolean(video.canPlayType('application/vnd.apple.mpegurl'))
  }, [])
  const [isPlaying, setIsPlaying] = useState(false)
  const helperMessage = useMemo(() => {
    if (!url) {
      return ''
    }
    if (!sanitizedUrl) {
      return '仅支持 http/https 的 m3u8 链接'
    }
    if (!supportsNativeHls && !Hls.isSupported()) {
      return '当前浏览器不支持 m3u8 播放'
    }
    return error
  }, [error, sanitizedUrl, supportsNativeHls, url])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    setError('')
    video.pause()
    video.removeAttribute('src')
    video.load()

    if (!sanitizedUrl) {
      return
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = sanitizedUrl
      return
    }

    if (!Hls.isSupported()) {
      return
    }

    const hls = new Hls()
    hls.loadSource(sanitizedUrl)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        setError('播放器加载失败，请检查 m3u8 链接是否可访问')
      }
    })

    return () => {
      hls.destroy()
    }
  }, [sanitizedUrl])

  const handlePlay = async () => {
    const video = videoRef.current
    if (!video) {
      return
    }
    try {
      await video.play()
      setIsPlaying(true)
    } catch {
      setError('播放失败，请检查链接是否可访问')
    }
  }

  const handlePause = () => {
    const video = videoRef.current
    if (!video) {
      return
    }
    video.pause()
    setIsPlaying(false)
  }

  const handlePiP = async () => {
    const video = videoRef.current
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
        支持在线播放 m3u8 链接，可用于任务创建前预览。
      </Typography>
      {helperMessage ? <Alert sx={{ mb: 2 }}>{helperMessage}</Alert> : null}
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
          minHeight: 280,
        }}
      >
        <video
          ref={videoRef}
          controls
          style={{ display: 'block', width: '100%', minHeight: 280 }}
        />
      </Box>
    </Paper>
  )
}

export default M3u8Player

function sanitizeM3u8Url(value: string) {
  if (!value.trim()) {
    return ''
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
