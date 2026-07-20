/**
 * OPTIMIZED ChatArea Component
 * 
 * Key Optimizations:
 * 1. API Response Caching - Prevents duplicate calls
 * 2. Debouncing - Prevents rapid-fire submissions
 * 3. Smart Classification - Only classifies once per session
 * 4. Conditional API Calls - Checks if data exists before calling
 * 
 * TO USE: Rename this file to ChatArea.jsx (backup the original first)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { apiCache, debounce } from '../lib/apiCache'
import '../styles/ChatArea.css'

export default function ChatArea({ 
  user, 
  currentSession, 
  setCurrentSession, 
  progress, 
  setProgress,
  onToggleProgress,
  onToggleHistory,
  showProgressSidebar,
  showHistorySidebar,
  setActivePhase
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [currentStage, setCurrentStage] = useState(1)
  const [caseData, setCaseData] = useState({
    category: null,
    courts: [],
    lawyers: [],
    displayedLawyers: 5,
    problemDescription: ''
  })
  const [seenPhases, setSeenPhases] = useState(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false) // Prevent double submissions
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const { signOut } = useAuth()
  const navigate = useNavigate()

  // Load seen phases from localStorage
  useEffect(() => {
    if (user?.id) {
      const userSeenPhases = JSON.parse(localStorage.getItem(`seenPhases_${user.id}`) || '[]')
      setSeenPhases(new Set(userSeenPhases))
    }
  }, [user])

  // Helper function to show phase card only if not seen before
  const showPhaseCard = (phase) => {
    if (!seenPhases.has(phase) && user?.id) {
      setActivePhase(phase)
      const newSeenPhases = new Set(seenPhases)
      newSeenPhases.add(phase)
      setSeenPhases(newSeenPhases)
      localStorage.setItem(`seenPhases_${user.id}`, JSON.stringify([...newSeenPhases]))
    }
  }

  // ... (rest of the useEffects remain the same)

  // OPTIMIZED: Debounced send message function
  const sendMessageDebounced = useCallback(
    debounce(async (messageContent) => {
      if (isSubmitting) {
        console.log('⏸️ Already submitting, skipping...')
        return
      }

      setIsSubmitting(true)
      
      try {
        await sendMessageInternal(messageContent)
      } finally {
        setIsSubmitting(false)
      }
    }, 500), // 500ms debounce
    [isSubmitting, currentStage, caseData, currentSession]
  )

  const sendMessage = async () => {
    if (!input.trim() || loading || isSubmitting) return
    
    const messageContent = input.trim()
    setInput('')
    
    const userMessage = {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString()
    }
    
    setMessages(prev => [...prev, userMessage])
    
    // Call debounced function
    sendMessageDebounced(messageContent)
  }

  // Internal send message function
  const sendMessageInternal = async (messageContent) => {
    let updatedProblemDescription = caseData.problemDescription
    if (!updatedProblemDescription && currentStage === 1) {
      updatedProblemDescription = messageContent
      setCaseData(prev => ({ ...prev, problemDescription: messageContent }))
    }

    setLoading(true)

    try {
      // Create session if doesn't exist
      let sessionId = currentSession?.id
      if (!sessionId) {
        const { data: newSession, error: sessionError } = await supabase
          .from('chat_sessions')
          .insert([{ user_id: user.id, title: messageContent.substring(0, 50) }])
          .select()
          .single()

        if (sessionError) throw sessionError
        sessionId = newSession.id
        setCurrentSession(newSession)
      }

      // Save user message
      await supabase.from('chat_messages').insert([{
        session_id: sessionId,
        role: 'user',
        content: messageContent
      }])

      // Call RAG chat API
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: messageContent,
          sessionId: sessionId,
          userId: user.id,
          stage: currentStage,
          caseCategory: caseData.category
        })
      })

      const data = await response.json()

      const assistantMessage = {
        role: 'assistant',
        content: data.response || 'I apologize, but I encountered an error. Please try again.',
        sources: data.sources,
        timestamp: new Date().toISOString()
      }

      setMessages(prev => [...prev, assistantMessage])

      if (currentStage === 1 && !progress.caseProblem) {
        setProgress(prev => ({ ...prev, caseProblem: true }))
      }

    } catch (error) {
      console.error('Error sending message:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  // OPTIMIZED: Proceed to Stage 2 with caching
  const proceedToStage2 = async () => {
    if (loading) return // Prevent double clicks
    
    setLoading(true)
    setCurrentStage(2)
    showPhaseCard(2)

    let problemDesc = caseData.problemDescription
    if (!problemDesc) {
      const firstUserMsg = messages.find(m => m.role === 'user')
      problemDesc = firstUserMsg?.content || 'Legal consultation'
      setCaseData(prev => ({ ...prev, problemDescription: problemDesc }))
    }

    if (currentSession?.id) {
      await supabase
        .from('chat_sessions')
        .update({ current_stage: 2 })
        .eq('id', currentSession.id)
    }

    try {
      // CHECK CACHE FIRST
      const cacheKey = apiCache.getClassificationKey(problemDesc)
      const cachedClassification = apiCache.get(cacheKey)

      let classifyData

      if (cachedClassification) {
        console.log('✅ Using cached classification')
        classifyData = cachedClassification
      } else {
        console.log('🔄 Calling classification API')
        // Classify case
        const classifyResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify-case`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ description: problemDesc })
        })

        classifyData = await classifyResponse.json()
        
        // CACHE THE RESULT
        apiCache.set(cacheKey, classifyData)
      }

      if (classifyData.category) {
        setCaseData(prev => ({ ...prev, category: classifyData.category }))
        setProgress(prev => ({ ...prev, caseCategory: true }))

        // CHECK CACHE FOR COURTS
        const courtCacheKey = apiCache.getCourtKey(classifyData.category, 'Karachi')
        const cachedCourts = apiCache.get(courtCacheKey)

        let courtData

        if (cachedCourts) {
          console.log('✅ Using cached courts')
          courtData = cachedCourts
        } else {
          console.log('🔄 Calling court API')
          // Get court recommendations
          const courtResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recommend-court`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              caseType: classifyData.category,
              city: 'Karachi'
            })
          })

          courtData = await courtResponse.json()
          
          // CACHE THE RESULT
          apiCache.set(courtCacheKey, courtData)
        }

        setCaseData(prev => ({ ...prev, courts: courtData.courts || [] }))

        // Display results
        const stage2Message = {
          role: 'assistant',
          content: `Based on your case, this appears to be a ${classifyData.category} law matter.\n\nI found ${courtData.courts?.length || 0} relevant court(s) in Karachi.\n\nWould you like to proceed to find suitable lawyers?${courtData.guidance ? `\n\n💡 **Important Guidance:**\n${courtData.guidance}` : ''}`,
          timestamp: new Date().toISOString()
        }
        
        setMessages(prev => [...prev, stage2Message])

        // Save to database
        await supabase.from('chat_messages').insert([{
          session_id: currentSession.id,
          role: 'assistant',
          content: stage2Message.content,
          metadata: {
            courts: courtData.courts || [],
            category: classifyData.category,
            stage: 2
          }
        }])
      } else {
        throw new Error('No category returned from classification')
      }
    } catch (error) {
      console.error('Error in stage 2:', error)
      setCurrentStage(1)
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error processing your case: ${error.message}\n\nPlease try clicking "Proceed to Stage 2" again, or describe your problem in more detail.`,
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  // OPTIMIZED: Proceed to Stage 3 with caching
  const proceedToStage3 = async () => {
    if (loading) return // Prevent double clicks
    
    setLoading(true)
    setCurrentStage(3)
    showPhaseCard(3)

    if (currentSession?.id) {
      await supabase
        .from('chat_sessions')
        .update({ current_stage: 3 })
        .eq('id', currentSession.id)
    }

    try {
      // CHECK CACHE FIRST
      const lawyerCacheKey = apiCache.getLawyerKey(caseData.category, 'Karachi')
      const cachedLawyers = apiCache.get(lawyerCacheKey)

      let lawyerData

      if (cachedLawyers) {
        console.log('✅ Using cached lawyers')
        lawyerData = cachedLawyers
      } else {
        console.log('🔄 Calling lawyer API')
        // Get lawyer recommendations
        const lawyerResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recommend-lawyer`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            caseType: caseData.category,
            city: 'Karachi',
            minExperience: 2,
            minRating: 3.5
          })
        })

        lawyerData = await lawyerResponse.json()
        
        // CACHE THE RESULT
        apiCache.set(lawyerCacheKey, lawyerData)
      }

      setCaseData(prev => ({ ...prev, lawyers: lawyerData.lawyers || [] }))
      setProgress(prev => ({ ...prev, lawyerProvision: true }))

      // Display results
      const stage3Message = {
        role: 'assistant',
        content: `I found ${lawyerData.lawyers?.length || 0} qualified lawyer(s) specializing in ${caseData.category} law in Karachi.\n\nThey are ranked by match score based on experience, rating, and success rate.\n\nWould you like to see the complete summary of your consultation?`,
        timestamp: new Date().toISOString()
      }
      
      setMessages(prev => [...prev, stage3Message])

      // Save to database
      await supabase.from('chat_messages').insert([{
        session_id: currentSession.id,
        role: 'assistant',
        content: stage3Message.content,
        metadata: {
          lawyers: lawyerData.lawyers || [],
          stage: 3
        }
      }])

    } catch (error) {
      console.error('Error in stage 3:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}\n\nPlease try again.`,
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  // ... (rest of the component remains the same)

  return (
    // ... (JSX remains the same)
  )
}
