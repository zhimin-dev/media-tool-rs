import { useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { createTask, uploadVideo } from '../api'

function CutCreatePage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const objectUrlRef = useRef<string>('')
  const [hasVideo, setHasVideo] = useState(false)
  const [inputPath, setInputPath] = useState('')
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [endTime, setEndTime] = useState<number | null>(null)
  const [targetFileName, setTargetFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const uploadSeqRef = useRef(0)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const currentUploadSeq = uploadSeqRef.current + 1
    uploadSeqRef.current = currentUploadSeq

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    const video = videoRef.current
    if (video) {
      video.src = url
      video.load()
    }
    setHasVideo(true)
    setUploading(true)
    setInputPath('')
    setStartTime(null)
    setEndTime(null)
    setCurrentTime(0)
    setVideoDuration(0)
    setError('')

    try {
      const uploaded = await uploadVideo(file)
      if (uploadSeqRef.current !== currentUploadSeq) return
      setInputPath(uploaded.path)
    } catch (err) {
      if (uploadSeqRef.current !== currentUploadSeq) return
      setError(err instanceof Error ? err.message : '上传文件失败')
    } finally {
      if (uploadSeqRef.current === currentUploadSeq) {
        setUploading(false)
      }
    }
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    setVideoDuration(Math.floor(video.duration))
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(Math.floor(video.currentTime))
  }

  const handleSliderChange = (_: Event, value: number | number[]) => {
    const video = videoRef.current
    if (!video) return
    const time = Array.isArray(value) ? value[0] : value
    video.currentTime = time
    setCurrentTime(time)
  }

  const canCreate =
    inputPath.trim() !== '' &&
    startTime !== null &&
    endTime !== null &&
    endTime > startTime

  const handleCreate = async () => {
    if (!canCreate || startTime === null || endTime === null) return

    const duration = endTime - startTime
    setLoading(true)
    setError('')
    try {
      await createTask({
        payload: {
          kind: 'cut',
          input: inputPath.trim(),
          start: startTime,
          duration,
          target_file_name: targetFileName,
        },
      })
      navigate('/cut')
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">新建截取任务</Typography>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Button variant="outlined" component="label" sx={{ alignSelf: 'flex-start' }}>
          {uploading ? '上传中...' : '选择视频文件'}
          <input type="file" accept="video/*" hidden onChange={handleFileSelect} />
        </Button>

        <TextField
          fullWidth
          label="输入文件路径"
          value={inputPath}
          helperText="选择文件后将先上传到服务器并自动填入真实路径，也可手动输入完整路径"
          onChange={(event) => setInputPath(event.target.value)}
        />

        {hasVideo ? (
          <Box sx={{ backgroundColor: '#000', borderRadius: 2, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              controls
              style={{ width: '100%', maxHeight: 400, display: 'block' }}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
            />
          </Box>
        ) : null}

        {videoDuration > 0 ? (
          <Stack spacing={1}>
            <Typography variant="body2">
              当前时间：{currentTime}s &nbsp;/&nbsp; 总时长：{videoDuration}s
            </Typography>
            <Slider
              min={0}
              max={videoDuration}
              value={currentTime}
              step={1}
              onChange={handleSliderChange}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${String(v)}s`}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" size="small" onClick={() => setStartTime(currentTime)}>
                标记开始（{currentTime}s）
              </Button>
              <Button variant="outlined" size="small" onClick={() => setEndTime(currentTime)}>
                标记结束（{currentTime}s）
              </Button>
            </Stack>
            <Stack direction="row" spacing={2}>
              {startTime !== null ? (
                <Typography variant="body2">开始：{startTime}s</Typography>
              ) : null}
              {endTime !== null ? (
                <Typography variant="body2">结束：{endTime}s</Typography>
              ) : null}
              {startTime !== null && endTime !== null && endTime > startTime ? (
                <Typography variant="body2">截取时长：{endTime - startTime}s</Typography>
              ) : null}
            </Stack>
            {endTime !== null && startTime !== null && endTime <= startTime ? (
              <Alert severity="warning">结束时间必须大于开始时间</Alert>
            ) : null}
          </Stack>
        ) : null}

        <TextField
          fullWidth
          label="输出文件名（可选）"
          value={targetFileName}
          helperText="不填则使用随机文件名；填写后会自动补全 .mp4"
          slotProps={{
            input: {
              endAdornment: <InputAdornment position="end">.mp4</InputAdornment>,
            },
          }}
          onChange={(event) => setTargetFileName(event.target.value)}
        />

        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => navigate('/cut')}>
            返回
          </Button>
          <Button
            variant="contained"
            disabled={!canCreate || loading}
            onClick={() => void handleCreate()}
          >
            {loading ? '创建中...' : '创建截取任务'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

export default CutCreatePage
