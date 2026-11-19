import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard, pages } from './dashboard.js'
import './style.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } })
function NotFound () { return <main className='login'><h1>Página no encontrada</h1><a href='/'>Volver al inicio</a></main> }
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Routes><Route element={<Dashboard />}>{pages.map(p => <Route key={p.path} path={p.path} element={<p.component />} />)}</Route><Route path='*' element={<NotFound />} /></Routes></BrowserRouter></QueryClientProvider></StrictMode>
)
