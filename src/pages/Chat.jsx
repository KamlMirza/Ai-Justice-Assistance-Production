import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import ProgressSidebar from '../components/ProgressSidebar'
import ChatArea from '../components/ChatArea'
import HistorySidebar from '../components/HistorySidebar'
import PhaseCard from '../components/PhaseCard'
import '../styles/Chat.css'

export default function Chat() {
  const { user } = useAuth()
  const [showProgressSidebar, setShowProgressSidebar] = useState(true)
  const [showHistorySidebar, setShowHistorySidebar] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [currentSession, setCurrentSession] = useState(null)
  const [progress, setProgress] = useState({
    caseProblem: false,
    caseCategory: false,
    lawyerProvision: false,
    summary: false
  })
  const [activePhase, setActivePhase] = useState(null)
  const [shouldShowPhaseCards, setShouldShowPhaseCards] = useState(true)

  // Check if user has disabled phase cards
  useEffect(() => {
    if (user?.id) {
      const hidePhaseCards = JSON.parse(localStorage.getItem('hidePhaseCards') || '{}')
      setShouldShowPhaseCards(!hidePhaseCards[user.id])
    }
  }, [user])

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
      if (window.innerWidth <= 768) {
        setShowProgressSidebar(false)
        setShowHistorySidebar(false)
      } else {
        setShowProgressSidebar(true)
        setShowHistorySidebar(true)
      }
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Reset progress when starting a new chat
  useEffect(() => {
    if (currentSession === null) {
      setProgress({
        caseProblem: false,
        caseCategory: false,
        lawyerProvision: false,
        summary: false
      })
    }
  }, [currentSession])

  const toggleProgressSidebar = () => {
    setShowProgressSidebar(!showProgressSidebar)
    if (isMobile && !showProgressSidebar) {
      setShowHistorySidebar(false)
    }
  }

  const toggleHistorySidebar = () => {
    setShowHistorySidebar(!showHistorySidebar)
    if (isMobile && !showHistorySidebar) {
      setShowProgressSidebar(false)
    }
  }

  return (
    <div className="chat-container">
      {/* Progress Sidebar */}
      <ProgressSidebar 
        show={showProgressSidebar}
        onClose={() => setShowProgressSidebar(false)}
        progress={progress}
        isMobile={isMobile}
      />

      {/* Main Chat Area */}
      <ChatArea 
        user={user}
        currentSession={currentSession}
        setCurrentSession={setCurrentSession}
        progress={progress}
        setProgress={setProgress}
        onToggleProgress={toggleProgressSidebar}
        onToggleHistory={toggleHistorySidebar}
        showProgressSidebar={showProgressSidebar}
        showHistorySidebar={showHistorySidebar}
        setActivePhase={setActivePhase}
      />

      {/* History Sidebar */}
      <HistorySidebar 
        show={showHistorySidebar}
        onClose={() => setShowHistorySidebar(false)}
        currentSession={currentSession}
        setCurrentSession={setCurrentSession}
        userId={user?.id}
        isMobile={isMobile}
      />

      {/* Phase Card */}
      {activePhase && shouldShowPhaseCards && (
        <PhaseCard 
          phase={activePhase}
          onClose={() => setActivePhase(null)}
          userId={user?.id}
        />
      )}

      {/* Mobile Overlay */}
      {isMobile && (showProgressSidebar || showHistorySidebar) && (
        <div 
          className="mobile-overlay"
          onClick={() => {
            setShowProgressSidebar(false)
            setShowHistorySidebar(false)
          }}
        />
      )}
    </div>
  )
}
