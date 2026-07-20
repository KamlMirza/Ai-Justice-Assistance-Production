import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import '../styles/Sidebar.css'

export default function HistorySidebar({ show, onClose, currentSession, setCurrentSession, userId, isMobile }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userId) {
      loadSessions()
    }
  }, [userId])

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      setSessions(data || [])
    } catch (error) {
      console.error('Error loading sessions:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now - date)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  const createNewSession = () => {
    // Clear current session to start fresh
    setCurrentSession(null)
    // Reload sessions list
    loadSessions()
    if (isMobile) onClose()
  }

  const deleteSession = async (sessionId, e) => {
    e.stopPropagation() // Prevent triggering the session click
    
    if (!confirm('Are you sure you want to delete this chat?')) {
      return
    }

    try {
      // Delete all messages in the session first
      await supabase
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId)

      // Delete the session
      const { error } = await supabase
        .from('chat_sessions')
        .delete()
        .eq('id', sessionId)

      if (error) throw error

      // If deleted session was current, clear it
      if (currentSession?.id === sessionId) {
        setCurrentSession(null)
      }

      // Reload sessions
      loadSessions()
    } catch (error) {
      console.error('Error deleting session:', error)
      alert('Failed to delete chat. Please try again.')
    }
  }

  return (
    <div className={`sidebar history-sidebar ${show ? 'show' : ''} ${isMobile ? 'mobile' : ''}`}>
      <div className="sidebar-header">
        <h2>Chat History</h2>
        {isMobile && (
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      <button className="new-chat-btn btn-glow" onClick={createNewSession}>
        + New Chat
      </button>

      <div className="history-list">
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <p>No chat history yet</p>
            <small>Start a new conversation</small>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`history-item ${currentSession?.id === session.id ? 'active' : ''}`}
            >
              <div 
                className="history-item-content"
                onClick={() => {
                  setCurrentSession(session)
                  if (isMobile) onClose()
                }}
              >
                <h4>{session.title || 'Untitled Chat'}</h4>
                <span className="history-date">{formatDate(session.created_at)}</span>
              </div>
              <button 
                className="delete-btn"
                onClick={(e) => deleteSession(session.id, e)}
                title="Delete chat"
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
