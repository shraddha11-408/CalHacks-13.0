import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
// Atkinson Hyperlegible, self-hosted (same Google Fonts files, works offline on the hotspot).
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './styles/tokens.css'
import './styles/app.css'
import { Layout } from './components/Layout'
import { CoachPage } from './pages/Coach'
import { HealthPage } from './pages/Health'
import { StepsPage } from './pages/Steps'
import { SupervisorPage } from './pages/Supervisor'
import { TeachPage } from './pages/Teach'
import { VideoPage } from './pages/Video'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SupervisorPage />} />
          <Route path="video" element={<VideoPage />} />
          <Route path="teach" element={<TeachPage />} />
          <Route path="coach" element={<CoachPage />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="*" element={<SupervisorPage />} />
        </Route>
        <Route path="steps" element={<StepsPage />} />
        <Route path="steps/:taskId" element={<StepsPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
