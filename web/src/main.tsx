import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './styles/tokens.css'
import './styles/app.css'
import './styles/idd.css'
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/800.css'
import '@fontsource/onest/400.css'
import '@fontsource/onest/500.css'
import '@fontsource/onest/600.css'
import '@fontsource/spline-sans-mono/400.css'
import '@fontsource/spline-sans-mono/500.css'
import './styles/piedra.css'
import './styles/home.css'
import './styles/supervisor.css'
import './styles/worker.css'
import './styles/viz.css'
import { HeaderOnly, Layout } from './components/Layout'
import { RequiresEdge } from './components/RequiresEdge'
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
import { WhyPage } from './pages/Why'
import { WorkerPage, WorkerTaskPage } from './pages/Worker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* IDD Help */}
        <Route index element={<HomePage />} />
        <Route path="why" element={<WhyPage />} />
        <Route path="choose" element={<ChoosePage />} />
        <Route path="worker" element={<RequiresEdge><WorkerPage /></RequiresEdge>} />
        <Route path="worker/:taskId" element={<RequiresEdge><WorkerTaskPage /></RequiresEdge>} />
        <Route path="supervisor" element={<RequiresEdge><SupervisorHomePage /></RequiresEdge>} />
        <Route path="buddy" element={<RequiresEdge><BuddyPage /></RequiresEdge>} />
        {/* earlier build pages (dev / judging slices), kept under /lab */}
        <Route element={<Layout />}>
          <Route path="lab" element={<RequiresEdge><SupervisorPage /></RequiresEdge>} />
          <Route path="video" element={<RequiresEdge><VideoPage /></RequiresEdge>} />
          <Route path="teach" element={<RequiresEdge><TeachPage /></RequiresEdge>} />
          <Route path="coach" element={<RequiresEdge><CoachPage /></RequiresEdge>} />
          <Route path="health" element={<RequiresEdge><HealthPage /></RequiresEdge>} />
        </Route>
        <Route element={<HeaderOnly />}>
          <Route path="steps" element={<RequiresEdge><StepsPage /></RequiresEdge>} />
          <Route path="steps/:taskId" element={<RequiresEdge><StepsPage /></RequiresEdge>} />
        </Route>
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
