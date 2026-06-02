import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import type { HeaderRow } from '../types'

type HeaderRowFieldsProps = {
  rows: HeaderRow[]
  title: string
  keyLabel: string
  valueLabel: string
  addLabel: string
  size?: 'small' | 'medium'
  buttonSize?: 'small' | 'medium'
  onChange: (index: number, field: keyof HeaderRow, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}

function HeaderRowFields({
  rows,
  title,
  keyLabel,
  valueLabel,
  addLabel,
  size = 'medium',
  buttonSize = 'medium',
  onChange,
  onAdd,
  onRemove,
}: HeaderRowFieldsProps) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{title}</Typography>
      {rows.map((row, index) => (
        <Stack key={`${index}-${row.key}`} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            fullWidth
            size={size}
            label={keyLabel}
            value={row.key}
            onChange={(event) => onChange(index, 'key', event.target.value)}
          />
          <TextField
            fullWidth
            size={size}
            label={valueLabel}
            value={row.value}
            onChange={(event) => onChange(index, 'value', event.target.value)}
          />
          <Button color="error" size={buttonSize} variant="outlined" onClick={() => onRemove(index)}>
            删除
          </Button>
        </Stack>
      ))}
      <Box>
        <Button size={buttonSize} variant="text" onClick={onAdd}>
          {addLabel}
        </Button>
      </Box>
    </Stack>
  )
}

export default HeaderRowFields
