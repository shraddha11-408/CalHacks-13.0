import type { VideoJob } from './api'

/** Video → steps job stages, in order (edge api.run_video_job). */
export const STAGES: { key: VideoJob['stage']; label: string }[] = [
  { key: 'transcribing', label: 'Listening to the audio (Cartesia)' },
  { key: 'cloning_voice', label: 'Cloning your voice (Cartesia, with your consent)' },
  { key: 'key_frames', label: 'Picking key frames, blurring faces' },
  { key: 'claude', label: 'Claude is breaking it into steps' },
  { key: 'saving', label: 'Saving the tasks' },
  { key: 'recording_voice', label: 'Recording the voice (Cartesia)' },
]
