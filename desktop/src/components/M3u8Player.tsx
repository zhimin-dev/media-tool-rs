import { Alert, Box, Paper, Typography } from '@mui/material'
import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'

type M3u8PlayerProps = {
  url: string
}

function M3u8Player({ url }: M3u8PlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    setError('')
    video.pause()
    video.removeAttribute('src')
    video.load()

    if (!url) {
      return
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      return
    }

    if (!Hls.isSupported()) {
      setError('当前浏览器不支持 m3u8 播放')
      return
    }

    const hls = new Hls()
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        setError('播放器加载失败，请检查 m3u8 链接是否可访问')
      }
    })

    return () => {
      hls.destroy()
    }
  }, [url])

  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        在线播放
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        支持在线播放 m3u8 链接，可用于任务创建前预览。
      </Typography>
      {error ? <Alert sx={{ mb: 2 }}>{error}</Alert> : null}
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
