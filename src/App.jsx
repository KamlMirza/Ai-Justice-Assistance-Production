import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Chat from './pages/Chat'
import ForgotPassword from './pages/ForgotPassword'
import Terms from './pages/Terms'
import LawyerSignup from './pages/LawyerSignup'
import LawyerProfile from './pages/LawyerProfile'

function PostLoginRedirect() {
  const { user, loading } = useAuth()
  const [destination, setDestination] = useState(null)

  useEffect(() => {
    const resolveDestination = async () => {
      if (loading) return

      if (!user) {
        setDestination('/login')
        return
      }

      const { data: lawyerProfile } = await supabase
        .from('lawyers')
        .select('id')
        .eq('email', user.email)
        .eq('is_platform_lawyer', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      setDestination(lawyerProfile?.id ? `/lawyer/${lawyerProfile.id}` : '/chat')
    }

    resolveDestination()
  }, [user, loading])

  if (loading || !destination) {
    return <div>Loading...</div>
  }

  return <Navigate to={destination} replace />
}

// Protected Route Component
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div>Loading...</div>
  }
  
  return user ? children : <Navigate to="/login" />
}

// Public Route Component (redirect to chat if already logged in)
function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div>Loading...</div>
  }
  
  return !user ? children : <Navigate to="/post-login" replace />
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" />} />
          <Route path="/post-login" element={<PostLoginRedirect />} />
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
          <Route path="/law-sign" element={<LawyerSignup />} />
          <Route path="/lawyer/:id" element={<LawyerProfile />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
