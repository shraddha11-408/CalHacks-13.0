import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
// Atkinson Hyperlegible, self-hosted (same Google Fonts files, works offline on the hotspot).
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/idd.css'
import { Layout } from './components/Layout'
import { BuddyPage } from './pages/Buddy'
import { ChoosePage } from './pages/Choose'
import { CoachPage } from './pages/Coach'
import { HealthPage } from './pages/Health'
import { HomePage } from './pages/Home'
import { StepsPage } from './pages/Steps'
import { SupervisorPage } from './pages/Supervisor'
import { SupervisorHomePage } from './pages/SupervisorHome'
import { TeachPage } from './pages/Teach'
import { VideoPage } from './pages/Video'
import { WorkerPage, WorkerTaskPage } from './pages/Worker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* IDD Help */}
        <Route index element={<HomePage />} />
        <Route path="choose" element={<ChoosePage />} />
        <Route path="worker" element={<WorkerPage />} />
        <Route path="worker/:taskId" element={<WorkerTaskPage />} />
        <Route path="supervisor" element={<SupervisorHomePage />} />
        <Route path="buddy" element={<BuddyPage />} />
        {/* earlier build pages (dev / judging slices), kept under /lab */}
        <Route element={<Layout />}>
          <Route path="lab" element={<SupervisorPage />} />
          <Route path="video" element={<VideoPage />} />
          <Route path="teach" element={<TeachPage />} />
          <Route path="coach" element={<CoachPage />} />
          <Route path="health" element={<HealthPage />} />
        </Route>
        <Route path="steps" element={<StepsPage />} />
        <Route path="steps/:taskId" element={<StepsPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
