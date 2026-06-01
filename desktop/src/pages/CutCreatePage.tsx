import { useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { createCutBatch, uploadVideo } from '../api'

type Segment = { start: number; end: number; fileName: string }

function CutCreatePage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const objectUrlRef = useRef<string>('')
  const [hasVideo, setHasVideo] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [inputPath, setInputPath] = useState('')
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [endTime, setEndTime] = useState<number | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deleteInputFile, setDeleteInputFile] = useState(false)
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
    setVideoUrl(url.startsWith('blob:') ? url : '')
    setHasVideo(true)
    setUploading(true)
    setInputPath('')
    setStartTime(null)
    setEndTime(null)
    setSegments([])
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

  const canCreate = inputPath.trim() !== '' && segments.length > 0
  const safeVideoUrl = isSafeBlobUrl(videoUrl) ? videoUrl : undefined
  const showSegmentInputs = inputPath.trim() !== ''

  const handleAddSegment = () => {
    if (startTime === null || endTime === null) {
      setError('请先标记开始和结束时间')
      return
    }
    if (endTime <= startTime) {
      setError('结束时间必须大于开始时间')
      return
    }
    setError('')
    setSegments((current) => [...current, { start: startTime, end: endTime, fileName: '' }])
    setStartTime(null)
    setEndTime(null)
  }

  const handleSegmentFileNameChange = (index: number, value: string) => {
    setSegments((current) => current.map((seg, i) => (i === index ? { ...seg, fileName: value } : seg)))
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setLoading(true)
    setError('')
    try {
      await createCutBatch({
        input: inputPath.trim(),
        delete_input_file: deleteInputFile,
        segments: segments.map((segment) => ({
          start: segment.start,
          duration: segment.end - segment.start,
          target_file_name: segment.fileName.trim(),
        })),
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
              src={safeVideoUrl}
              controls
              style={{ width: '100%', maxHeight: 400, display: 'block' }}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
            />
          </Box>
        ) : null}

        {showSegmentInputs ? (
          <Stack spacing={1}>
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
              </Stack>
            ) : null}

            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="开始时间（秒）"
                type="number"
                size="small"
                value={startTime ?? ''}
                sx={{ width: 160 }}
                slotProps={{ htmlInput: { min: 0 } }}
                onChange={(event) =>
                  setStartTime(event.target.value === '' ? null : Math.max(0, Number(event.target.value)))
                }
              />
              <TextField
                label="结束时间（秒）"
                type="number"
                size="small"
                value={endTime ?? ''}
                sx={{ width: 160 }}
                slotProps={{ htmlInput: { min: 0 } }}
                onChange={(event) =>
                  setEndTime(event.target.value === '' ? null : Math.max(0, Number(event.target.value)))
                }
              />
              <Button variant="contained" size="small" onClick={handleAddSegment} sx={{ mt: 0.5 }}>
                添加片段
              </Button>
            </Stack>

            {startTime !== null && endTime !== null && endTime > startTime ? (
              <Typography variant="body2">截取时长：{endTime - startTime}s</Typography>
            ) : null}
            {endTime !== null && startTime !== null && endTime <= startTime ? (
              <Alert severity="warning">结束时间必须大于开始时间</Alert>
            ) : null}

            {segments.length > 0 ? (
              <Stack spacing={0.5}>
                <Typography variant="body2">已添加片段（{segments.length}）</Typography>
                {segments.map((segment, index) => (
                  <Stack
                    key={`${segment.start}-${segment.end}-${index}`}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Typography variant="body2" sx={{ minWidth: 180 }}>
                      {index + 1}. {segment.start}s - {segment.end}s（{segment.end - segment.start}s）
                    </Typography>
                    <TextField
                      label="文件名（可选）"
                      size="small"
                      value={segment.fileName}
                      sx={{ width: 200 }}
                      slotProps={{
                        input: {
                          endAdornment: <InputAdornment position="end">.mp4</InputAdornment>,
                        },
                      }}
                      onChange={(event) => handleSegmentFileNameChange(index, event.target.value)}
                    />
                    <Button
                      size="small"
                      onClick={() =>
                        setSegments((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      删除
                    </Button>
                  </Stack>
                ))}
              </Stack>
            ) : null}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={deleteInputFile}
                  onChange={(event) => setDeleteInputFile(event.target.checked)}
                />
              }
              label="子任务全部完成后删除输入视频"
            />
          </Stack>
        ) : null}

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

function isSafeBlobUrl(url: string) {
  return /^blob:[a-z]+:\/\//.test(url)
}
