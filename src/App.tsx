import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { JuryPage } from './pages/JuryPage';
import { OpsPage } from './pages/OpsPage';
import { PublicPage } from './pages/PublicPage';
import { VerifyPage } from './pages/VerifyPage';

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<PublicPage />} />
        <Route path="jury" element={<JuryPage />} />
        <Route path="verify" element={<VerifyPage />} />
        <Route path="ops" element={<OpsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
