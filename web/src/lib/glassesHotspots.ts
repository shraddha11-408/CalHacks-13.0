// Hotspots for the interactive glasses explorer. Written by the image-prep agent (coordinates measured on
// the images); read by GlassesExplorer. Coordinates are fractions (0–1) of the IMAGE the view shows.

export type Finish = 'ivory' | 'black'
export type ViewId = 'three-quarter' | 'right' | 'left'
export type PartId = 'camera' | 'touch' | 'led' | 'speaker-left' | 'speaker-right' | 'mic' | 'lens' | 'hinge'

export interface Part {
  id: PartId
  /** short label, sentence case */
  title: string
  /** one line: what it is */
  what: string
  /** one or two lines: what it does for the worker (plain words) */
  why: string
}

export interface Hotspot {
  part: PartId
  /** center of the component in the view image, fractions */
  x: number
  y: number
  /** radius of the component, fraction of image width (for the glow / loupe) */
  r: number
}

export interface GlassesView {
  id: ViewId
  label: string
  /** per finish: the cleaned smart image and the plain (ordinary glasses) image for this view, in /public */
  src: Record<Finish, { smart: string; plain: string }>
  /** natural size of the view images (px) */
  width: number
  height: number
  hotspots: Record<Finish, Hotspot[]>
}

export const PARTS: Record<PartId, Part> = {
  camera: {
    id: 'camera',
    title: 'Camera',
    what: 'Sees the work, not the person.',
    why: 'Checks each step as they do it. Faces are blurred before any frame leaves the laptop.',
  },
  touch: {
    id: 'touch',
    title: 'Touch sensor',
    what: 'A touch pad on the right arm.',
    why: 'Hold to call your supervisor. Tap to ask a question.',
  },
  led: {
    id: 'led',
    title: 'Status light',
    what: 'A small ring of light by the touch pad.',
    why: 'Glows when the coach is listening, or when a person is on the way.',
  },
  'speaker-left': {
    id: 'speaker-left',
    title: 'Left earbud',
    what: 'A tiny earbud at the end of the left arm.',
    why: "Their supervisor's voice, right at the ear. Steps, gentle fixes and praise.",
  },
  'speaker-right': {
    id: 'speaker-right',
    title: 'Right earbud',
    what: 'A tiny earbud at the end of the right arm.',
    why: "Their supervisor's voice, right at the ear. Steps, gentle fixes and praise.",
  },
  mic: {
    id: 'mic',
    title: 'Microphone',
    what: 'A tiny pinhole microphone.',
    why: "Hears \"Is this right?\" and answers out loud.",
  },
  lens: {
    id: 'lens',
    title: 'Lenses',
    what: 'Clear lenses, ready for a prescription.',
    why: 'Looks like ordinary glasses. No screen in the way.',
  },
  hinge: {
    id: 'hinge',
    title: 'Hinge',
    what: 'A metal hinge where the frame meets the arm.',
    why: 'Fits like everyday frames. Light enough for a full shift.',
  },
}

export const VIEWS: GlassesView[] = [
  {
    id: 'three-quarter',
    label: "Front",
    src: {
      ivory: { smart: '/media/glasses/ivory-smart-three-quarter.webp', plain: '/media/glasses/ivory-plain-three-quarter.webp' },
      black: { smart: '/media/glasses/black-smart-three-quarter.webp', plain: '/media/glasses/black-plain-three-quarter.webp' },
    },
    width: 1536,
    height: 658,
    hotspots: {
      ivory: [
        { part: 'camera', x: 0.6178, y: 0.5593, r: 0.0143 },
        { part: 'touch', x: 0.1432, y: 0.2979, r: 0.0182 },
        { part: 'led', x: 0.1849, y: 0.2933, r: 0.0085 },
        { part: 'mic', x: 0.2070, y: 0.2872, r: 0.0033 },
        { part: 'speaker-left', x: 0.9212, y: 0.5547, r: 0.0247 },
        { part: 'speaker-right', x: 0.4108, y: 0.3009, r: 0.0234 },
        { part: 'lens', x: 0.4818, y: 0.6687, r: 0.0716 },
        { part: 'hinge', x: 0.6706, y: 0.5608, r: 0.0156 },
      ],
      black: [
        { part: 'camera', x: 0.6263, y: 0.5486, r: 0.0163 },
        { part: 'touch', x: 0.1771, y: 0.2675, r: 0.0195 },
        { part: 'led', x: 0.2188, y: 0.2538, r: 0.0111 },
        { part: 'mic', x: 0.2507, y: 0.2386, r: 0.0033 },
        { part: 'speaker-left', x: 0.9583, y: 0.4742, r: 0.0260 },
        { part: 'speaker-right', x: 0.4831, y: 0.3009, r: 0.0247 },
        { part: 'lens', x: 0.4557, y: 0.6869, r: 0.0716 },
        { part: 'hinge', x: 0.6784, y: 0.5015, r: 0.0130 },
      ],
    },
  },
  {
    id: 'right',
    label: "Wearer's right",
    src: {
      ivory: { smart: '/media/glasses/ivory-smart-right.webp', plain: '/media/glasses/ivory-plain-right.webp' },
      black: { smart: '/media/glasses/black-smart-right.webp', plain: '/media/glasses/black-plain-right.webp' },
    },
    width: 764,
    height: 356,
    hotspots: {
      ivory: [
        { part: 'touch', x: 0.5196, y: 0.2893, r: 0.0288 },
        { part: 'led', x: 0.6113, y: 0.2809, r: 0.0183 },
        { part: 'speaker-right', x: 0.1309, y: 0.6039, r: 0.0445 },
        { part: 'lens', x: 0.9031, y: 0.4579, r: 0.0497 },
        { part: 'hinge', x: 0.7932, y: 0.2472, r: 0.0340 },
      ],
      black: [
        { part: 'touch', x: 0.6178, y: 0.3483, r: 0.0340 },
        { part: 'led', x: 0.7173, y: 0.3287, r: 0.0223 },
        { part: 'mic', x: 0.9045, y: 0.3034, r: 0.0065 },
        { part: 'speaker-right', x: 0.0759, y: 0.6236, r: 0.0524 },
        { part: 'lens', x: 0.9359, y: 0.4831, r: 0.0458 },
        { part: 'hinge', x: 0.8573, y: 0.2584, r: 0.0262 },
      ],
    },
  },
  {
    id: 'left',
    label: "Wearer's left",
    src: {
      ivory: { smart: '/media/glasses/ivory-smart-left.webp', plain: '/media/glasses/ivory-plain-left.webp' },
      black: { smart: '/media/glasses/black-smart-left.webp', plain: '/media/glasses/black-plain-left.webp' },
    },
    width: 764,
    height: 356,
    hotspots: {
      ivory: [
        { part: 'camera', x: 0.1374, y: 0.2472, r: 0.0183 },
        { part: 'speaker-left', x: 0.8495, y: 0.6039, r: 0.0445 },
        { part: 'lens', x: 0.0890, y: 0.4551, r: 0.0524 },
        { part: 'hinge', x: 0.1937, y: 0.2472, r: 0.0340 },
      ],
      black: [
        { part: 'camera', x: 0.0825, y: 0.3006, r: 0.0262 },
        { part: 'speaker-left', x: 0.9241, y: 0.6292, r: 0.0471 },
        { part: 'lens', x: 0.0995, y: 0.4831, r: 0.0419 },
        { part: 'hinge', x: 0.1623, y: 0.2753, r: 0.0288 },
      ],
    },
  },
]
