export interface HaloDropzoneProps {
  className?: string
  accept?: string
  multiple?: boolean
  disabled?: boolean
  translucent?: boolean
  onFiles?: (files: File[]) => void
  successResetMs?: number
  emptyLabel?: string
  successLabel?: string
  idleIcon?: React.ReactNode
  formatHint?: string | null
  showSuccessThumbnails?: boolean
}

import { motion } from 'motion/react'

export function HaloDropzone({ className, accept, multiple = false, disabled = false, translucent = true, onFiles, successResetMs = 2400, emptyLabel = "Drop files here or browse", successLabel = "Upload complete", idleIcon, formatHint = "PNG, JPG, PDF up to 10MB", showSuccessThumbnails = true }: HaloDropzoneProps) {
  return null
} // end function placeholder

