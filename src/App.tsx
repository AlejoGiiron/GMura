import { Routes, Route } from 'react-router-dom'

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="flex h-screen items-center justify-center bg-white">
            <h1 className="font-sans text-2xl font-semibold text-slate-900">G-Mura POS</h1>
          </div>
        }
      />
    </Routes>
  )
}
