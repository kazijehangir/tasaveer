import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { Dashboard } from "./pages/Dashboard";
import { Ingest } from "./pages/Ingest";
import { Sync } from "./pages/Sync";
import { Clean } from "./pages/Clean";
import { Organize } from "./pages/Organize";


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="ingest" element={<Ingest />} />
          <Route path="ingest" element={<Ingest />} />
          <Route path="clean" element={<Clean />} />
          <Route path="organize" element={<Organize />} />
          <Route path="sync" element={<Sync />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
