import { Paper, Stack, TextField } from '@mui/material'
import M3u8Player from '../components/M3u8Player'
import HeaderRowFields from '../components/HeaderRowFields'
import type { HeaderRow } from '../types'

type WatchPageProps = {
  playerUrl: string
  playerHeaders: Record<string, string>
  playerHeaderRows: HeaderRow[]
  onPlayerUrlChange: (value: string) => void
  onPlayerHeaderChange: (index: number, field: keyof HeaderRow, value: string) => void
  onAddPlayerHeader: () => void
  onRemovePlayerHeader: (index: number) => void
}

function WatchPage({
  playerUrl,
  playerHeaders,
  playerHeaderRows,
  onPlayerUrlChange,
  onPlayerHeaderChange,
  onAddPlayerHeader,
  onRemovePlayerHeader,
}: WatchPageProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <TextField fullWidth label="m3u8 链接" value={playerUrl} onChange={(event) => onPlayerUrlChange(event.target.value)} />
        <HeaderRowFields
          rows={playerHeaderRows}
          title="自定义 Header（可选）"
          keyLabel="Header 名称"
          valueLabel="Header 值"
          addLabel="添加 Header"
          onChange={onPlayerHeaderChange}
          onAdd={onAddPlayerHeader}
          onRemove={onRemovePlayerHeader}
        />
        {playerUrl ? <M3u8Player url={playerUrl} headers={playerHeaders} /> : null}
      </Stack>
    </Paper>
  )
}

export default WatchPage
