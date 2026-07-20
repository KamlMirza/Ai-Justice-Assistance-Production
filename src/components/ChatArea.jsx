import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import '../styles/ChatArea.css'

const MAX_EXTRACTED_CHARS = 6000

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
  const [currentStage, setCurrentStage] = useState(1) // 1: Problem, 2: Court, 3: Lawyer, 4: Summary
  const [selectedAttachment, setSelectedAttachment] = useState(null)
  const [caseData, setCaseData] = useState({
    category: null,
    courts: [],
    lawyers: [],
    displayedLawyers: 5,
    problemDescription: ''
  })
  const [seenPhases, setSeenPhases] = useState(new Set())
  const [lastAssistantOutOfDomain, setLastAssistantOutOfDomain] = useState(false)
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
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
      // Mark phase as seen
      const newSeenPhases = new Set(seenPhases)
      newSeenPhases.add(phase)
      setSeenPhases(newSeenPhases)
      localStorage.setItem(`seenPhases_${user.id}`, JSON.stringify([...newSeenPhases]))
    }
  }

  useEffect(() => {
    setLastAssistantOutOfDomain(false)
    if (currentSession) {
      loadMessages()
      // Restore stage and case data from session
      const restoredStage = currentSession.current_stage || 1
      setCurrentStage(restoredStage)
      // Don't show phase card when restoring session
      
      if (currentSession.case_data) {
        // Ensure case_data has all required fields
        const restoredCaseData = {
          category: currentSession.case_data.category || null,
          courts: currentSession.case_data.courts || [],
          lawyers: currentSession.case_data.lawyers || [],
          displayedLawyers: currentSession.case_data.displayedLawyers || 5,
          problemDescription: currentSession.case_data.problemDescription || ''
        }
        setCaseData(restoredCaseData)
      }
      
      // Update progress based on stage
      if (currentSession.current_stage >= 1) {
        setProgress(prev => ({ ...prev, caseProblem: true }))
      }
      if (currentSession.current_stage >= 2) {
        setProgress(prev => ({ ...prev, caseCategory: true }))
      }
      if (currentSession.current_stage >= 3) {
        setProgress(prev => ({ ...prev, lawyerProvision: true }))
      }
      if (currentSession.current_stage >= 4) {
        setProgress(prev => ({ ...prev, summary: true }))
      }
    } else {
      // Show welcome message
      setMessages([{
        role: 'assistant',
        content: "Hello! I'm your AI Justice Assistant. I'll guide you through 4 stages:\n\nStage 1: Describe your legal problem\nStage 2: Get court recommendations\nStage 3: Find suitable lawyers\nStage 4: Receive complete summary\n\nNote: We currently focus on Civil, Criminal, and Family cases with the most accurate guidance. Our system has limited data for other case types.\n\nLet's start! Please describe your case or legal problem in detail.",
        timestamp: new Date().toISOString()
      }])
      
      setCurrentStage(1)
      setCaseData({ category: null, courts: [], lawyers: [], displayedLawyers: 5, problemDescription: '' })
      setProgress({ caseProblem: false, caseCategory: false, lawyerProvision: false, summary: false })
      // Show phase 1 card only if user hasn't seen it before
      setTimeout(() => showPhaseCard(1), 1000)
    }
  }, [currentSession])

  useLayoutEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    const container = messagesContainerRef.current
    if (!container) return

    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: messages.length <= 1 ? 'auto' : 'smooth'
      })
    })
  }

  useEffect(() => {
    return () => {
      if (selectedAttachment?.previewUrl) {
        URL.revokeObjectURL(selectedAttachment.previewUrl)
      }
    }
  }, [selectedAttachment])

  const clearSelectedAttachment = () => {
    setSelectedAttachment(prev => {
      if (prev?.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl)
      }
      return null
    })

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const getAttachmentKind = (file) => {
    if (file.type.startsWith('image/')) return 'image'
    return 'file'
  }

  const getFileExtension = (fileName) => {
    const parts = fileName.split('.')
    return parts.length > 1 ? parts.pop().toLowerCase() : ''
  }

  const normalizeExtractedText = (text) => {
    return (text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_EXTRACTED_CHARS)
  }

  const extractTextFromPdf = async (file) => {
    const pdfjsLib = await import('pdfjs-dist')
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true })
    const pdf = await loadingTask.promise

    let fullText = ''
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')

      fullText += ` ${pageText}`

      if (fullText.length > MAX_EXTRACTED_CHARS * 2) {
        break
      }
    }

    return normalizeExtractedText(fullText)
  }

  const extractTextFromDocx = async (file) => {
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return normalizeExtractedText(result.value)
  }

  const extractTextFromImage = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64String = reader.result.split(',')[1];
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-ocr`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              image: base64String,
              mimeType: file.type || 'image/jpeg'
            })
          });

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to extract text from image');
          }

          const data = await response.json();
          resolve(normalizeExtractedText(data.text || ''));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  }

  const extractTextFromAttachment = async (file) => {
    const ext = getFileExtension(file.name)
    const mime = file.type

    if (mime === 'application/pdf' || ext === 'pdf') {
      return extractTextFromPdf(file)
    }

    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      return extractTextFromDocx(file)
    }

    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return extractTextFromImage(file)
    }

    // Legacy .doc is not reliably parseable in-browser.
    if (mime === 'application/msword' || ext === 'doc') {
      throw new Error('Legacy .doc files are not supported for text extraction. Please upload PDF or DOCX.')
    }

    throw new Error('Unsupported file format.')
  }

  const loadMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', currentSession.id)
        .order('created_at', { ascending: true })

      if (error) throw error
      
      // Restore message metadata (courts, lawyers, etc.)
      const restoredMessages = (data || []).map(msg => {
        const restored = { ...msg }
        
        // Restore courts from metadata
        if (msg.metadata?.courts) {
          restored.courts = msg.metadata.courts
          restored.category = msg.metadata.category
        }
        
        // Restore lawyers from metadata
        if (msg.metadata?.lawyers) {
          const allLawyers = msg.metadata.lawyers
          const displayCount = msg.metadata.displayedLawyers || 5
          restored.lawyers = allLawyers.slice(0, displayCount)
          restored.showMoreLawyers = allLawyers.length > displayCount
          restored.totalLawyers = allLawyers.length
        }
        
        // Restore summary flag
        if (msg.metadata?.isSummary) {
          restored.isSummary = true
        }

        if (msg.metadata?.attachment) {
          restored.attachment = {
            ...msg.metadata.attachment,
            previewUrl: null
          }
        }
        
        return restored
      })
      
      setMessages(restoredMessages)
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ]
    const allowedExtensions = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif', 'webp']
    const fileExtension = getFileExtension(file.name)

    if (!allowedMimeTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      alert('Please upload a PDF, DOC, or image file (JPG, PNG, GIF, WEBP)')
      return
    }

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB')
      return
    }

    clearSelectedAttachment()

    const kind = getAttachmentKind(file)
    const previewUrl = kind === 'image' ? URL.createObjectURL(file) : null

    setSelectedAttachment({
      file,
      kind,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl
    })
  }

  const handleSend = async () => {
    if ((!input.trim() && !selectedAttachment) || loading) return

    const messageText = input.trim()
    const attachment = selectedAttachment
    const attachmentSummary = attachment
      ? `${attachment.kind === 'image' ? 'Image' : 'File'} attached: ${attachment.name}`
      : ''
    const fullMessageContent = [messageText, attachmentSummary].filter(Boolean).join('\n\n')

    const userMessage = {
      role: 'user',
      content: fullMessageContent,
      attachment: attachment
        ? {
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            kind: attachment.kind,
            previewUrl: attachment.previewUrl
          }
        : null,
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    clearSelectedAttachment()

    let extractedDocumentText = ''
    if (attachment?.file) {
      try {
        extractedDocumentText = await extractTextFromAttachment(attachment.file)
        if (!extractedDocumentText) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'I could not extract readable text from that file. Please upload a clearer document/image or paste the text directly.',
            timestamp: new Date().toISOString()
          }])
          return
        }
      } catch (extractError) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: extractError.message || 'I could not process that file. Please upload PDF, DOCX, or an image with readable text.',
          timestamp: new Date().toISOString()
        }])
        return
      }
    }
    
    // Store first message as problem description
    let updatedProblemDescription = caseData.problemDescription
    if (!updatedProblemDescription && currentStage === 1) {
      const seededProblemDescription = extractedDocumentText
        ? `${fullMessageContent}\n\nDocument text:\n${extractedDocumentText}`
        : fullMessageContent
      updatedProblemDescription = seededProblemDescription
      setCaseData(prev => ({ ...prev, problemDescription: seededProblemDescription }))
    }

    setLoading(true)

    try {
      // Create session if doesn't exist
      let sessionId = currentSession?.id
      if (!sessionId) {
        const { data: newSession, error: sessionError } = await supabase
          .from('chat_sessions')
          .insert([{ user_id: user.id, title: fullMessageContent.substring(0, 50) || 'New legal consultation' }])
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
          content: userMessage.content,
          metadata: userMessage.attachment ? {
            attachment: {
              name: userMessage.attachment.name,
              type: userMessage.attachment.type,
              size: userMessage.attachment.size,
              kind: userMessage.attachment.kind,
              extractedTextPreview: extractedDocumentText.slice(0, 300)
            }
          } : undefined
      }])

      // Call RAG chat API based on current stage
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage.content,
          extractedDocumentText,
          hasAttachment: Boolean(userMessage.attachment),
          attachmentName: userMessage.attachment?.name,
          attachmentType: userMessage.attachment?.type,
          sessionId: sessionId,
          userId: user.id,
          stage: currentStage,
          caseCategory: caseData.category
        })
      })

      // Update session with case data to prevent loss on reload
      if (currentStage === 1 && updatedProblemDescription) {
        await supabase
          .from('chat_sessions')
          .update({ 
            case_data: { 
              ...caseData, 
              problemDescription: updatedProblemDescription 
            } 
          })
          .eq('id', sessionId)
      }

      const data = await response.json()
      const isOutOfDomain = Boolean(data.outOfDomain)

      // Store category from RAG response if identified (only trust real classifications, not defaults)
      const validCategories = ['Civil', 'Criminal', 'Family']
      if (data.category && validCategories.includes(data.category) && !caseData.category && !isOutOfDomain && data.intent === 'LEGAL_QUERY') {
        setCaseData(prev => ({ ...prev, category: data.category }))
        
        // Also update session
        await supabase
          .from('chat_sessions')
          .update({ 
            case_data: { 
              ...caseData, 
              problemDescription: updatedProblemDescription,
              category: data.category
            } 
          })
          .eq('id', sessionId)
      }

      const assistantMessage = {
        role: 'assistant',
        content: data.response || 'I apologize, but I encountered an error. Please try again.',
        sources: data.sources,
        timestamp: new Date().toISOString()
      }

      setMessages(prev => [...prev, assistantMessage])

      // Track domain rejection state
      setLastAssistantOutOfDomain(isOutOfDomain)

      // Check if the AI response indicates all case details are unknown (unreadable document)
      const responseText = (data.response || '').toLowerCase()
      const unknownCount = (responseText.match(/:\s*unknown/g) || []).length
      const isAllUnknown = unknownCount >= 3 // Case Type, Applicable Law, Nature, Police Station — if 3+ are Unknown, it's unresolved

      // Mark stage 1 as complete after first response (only if in-domain AND case details were actually identified)
      if (currentStage === 1 && !progress.caseProblem && !isOutOfDomain && !isAllUnknown) {
        setProgress(prev => ({ ...prev, caseProblem: true }))
      }

      // If all details are unknown, show guidance to the user and don't allow progression
      if (currentStage === 1 && isAllUnknown && !isOutOfDomain) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'I was unable to extract enough details from your document to proceed. Please try one of the following:\n\n- Upload a clearer image with better lighting\n- Type out the key details of your case manually\n- Paste the text from the document directly\n\nOnce I can identify your case type, I will be able to recommend courts and lawyers.',
          timestamp: new Date().toISOString()
        }])
        setProgress(prev => ({ ...prev, caseProblem: false }))
      }

      // If this is out-of-domain, reset caseProblem to prevent button showing
      if (isOutOfDomain) {
        setProgress(prev => ({ ...prev, caseProblem: false }))
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

  const proceedToStage2 = async () => {
    setLoading(true)
    setCurrentStage(2)
    showPhaseCard(2)

    // Get problem description from first user message if not saved
    let problemDesc = caseData.problemDescription
    if (!problemDesc) {
      const firstUserMsg = messages.find(m => m.role === 'user')
      problemDesc = firstUserMsg?.content || 'Legal consultation'
      setCaseData(prev => ({ ...prev, problemDescription: problemDesc }))
    }

    // Update session stage in database
    if (currentSession?.id) {
      await supabase
        .from('chat_sessions')
        .update({ current_stage: 2 })
        .eq('id', currentSession.id)
    }

    try {
      let classifyData;
      
      // If we already have a category from Stage 1, use it and don't re-classify blindly
      if (caseData.category) {
        classifyData = {
          category: caseData.category,
          confidence: 0.95,
          reasoning: `Based on the initial analysis of your case details, it falls under ${caseData.category} matters.`
        };
      } else {
        // Classify case
        const classifyResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify-case`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ description: problemDesc })
        })

        if (!classifyResponse.ok) {
          throw new Error(`Classification failed: ${classifyResponse.status}`)
        }

        classifyData = await classifyResponse.json()

        if (classifyData.error) {
          throw new Error(classifyData.error)
        }
      }

      if (classifyData.category) {
        setCaseData(prev => ({ ...prev, category: classifyData.category }))
        setProgress(prev => ({ ...prev, caseCategory: true }))

        // Get court recommendations
        const courtResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recommend-court`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            caseType: classifyData.category,
            city: 'Karachi',
            description: problemDesc
          })
        })

        const courtData = await courtResponse.json()
        const updatedCaseData = { 
          ...caseData, 
          category: classifyData.category, 
          courts: courtData.courts || [],
          problemDescription: problemDesc
        }
        setCaseData(updatedCaseData)

        // Save case data to session
        if (currentSession?.id) {
          await supabase
            .from('chat_sessions')
            .update({ 
              case_data: updatedCaseData,
              current_stage: 2
            })
            .eq('id', currentSession.id)
        }

        const stage2Message = {
          role: 'assistant',
          content: `**Stage 2: Case Classification & Court Recommendations**\n\nYour case has been classified as **${classifyData.category}** (${Math.round(classifyData.confidence * 100)}% confidence).\n\n${classifyData.reasoning}\n\nI found ${courtData.courts?.length || 0} suitable courts for your case. You can ask me questions about these courts or the legal process.${courtData.guidance ? `\n\n💡 **Important Guidance:**\n${courtData.guidance}` : ''}`,
          courts: courtData.courts || [],
          category: classifyData.category,
          timestamp: new Date().toISOString()
        }
        
        setMessages(prev => [...prev, stage2Message])
        
        // Save message with metadata to database
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
      
      // Revert to stage 1 on error
      setCurrentStage(1)
      // Don't show phase card on error
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error processing your case: ${error.message}\n\nPlease try clicking "Proceed to Stage 2" again, or describe your problem in more detail.`,
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  const proceedToStage3 = async () => {
    setLoading(true)
    setCurrentStage(3)
    showPhaseCard(3)

    // Update session stage in database
    if (currentSession?.id) {
      await supabase
        .from('chat_sessions')
        .update({ current_stage: 3 })
        .eq('id', currentSession.id)
    }

    try {
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
          minExperience: 3
        })
      })

      const lawyerData = await lawyerResponse.json()
      const allLawyers = lawyerData.lawyers || []
      const topLawyers = allLawyers.slice(0, 5) // Show only 5 initially
      const updatedCaseData = { ...caseData, lawyers: allLawyers, displayedLawyers: 5 }
      setCaseData(updatedCaseData)
      setProgress(prev => ({ ...prev, lawyerProvision: true }))

      // Save case data to session
      if (currentSession?.id) {
        await supabase
          .from('chat_sessions')
          .update({ 
            case_data: updatedCaseData,
            current_stage: 3
          })
          .eq('id', currentSession.id)
      }

      const stage3Message = {
        role: 'assistant',
        content: `Stage 3: Lawyer Recommendations\n\nBased on your ${caseData.category} case, here are the top ${topLawyers.length} recommended lawyers.\n\nNote: We currently focus on Civil, Criminal, and Family cases with limited data. Our recommendations are based on available information.`,
        lawyers: topLawyers,
        showMoreLawyers: allLawyers.length > 5,
        totalLawyers: allLawyers.length,
        timestamp: new Date().toISOString()
      }
      
      setMessages(prev => [...prev, stage3Message])
      
      // Save message with metadata to database
      await supabase.from('chat_messages').insert([{
        session_id: currentSession.id,
        role: 'assistant',
        content: stage3Message.content,
        metadata: {
          lawyers: allLawyers,
          displayedLawyers: 5,
          stage: 3
        }
      }])
    } catch (error) {
      console.error('Error in stage 3:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error finding lawyers. Please try again.',
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  const showMoreLawyers = (messageIndex) => {
    setMessages(prev => {
      const updated = [...prev]
      const msg = updated[messageIndex]
      
      // Get all lawyers from metadata or caseData
      const allLawyers = msg.metadata?.lawyers || caseData.lawyers
      
      if (msg.lawyers && allLawyers.length > msg.lawyers.length) {
        const currentCount = msg.lawyers.length
        const newCount = Math.min(currentCount + 5, allLawyers.length)
        msg.lawyers = allLawyers.slice(0, newCount)
        msg.showMoreLawyers = newCount < allLawyers.length
      }
      return updated
    })
  }

  const generateSummary = async () => {
    setLoading(true)
    setCurrentStage(4)
    setProgress(prev => ({ ...prev, summary: true }))

    // Update session stage in database
    if (currentSession?.id) {
      await supabase
        .from('chat_sessions')
        .update({ current_stage: 4 })
        .eq('id', currentSession.id)
    }

    try {
      const summaryPrompt = `Generate a comprehensive legal consultation summary for the following case:

Problem: ${caseData.problemDescription}
Category: ${caseData.category}
Courts: ${caseData.courts.map(c => c.name).join(', ')}
Lawyers: ${caseData.lawyers.slice(0, 3).map(l => l.name).join(', ')}

Provide a professional summary including:
1. Case Overview
2. Applicable Laws
3. Recommended Solution
4. Court Information
5. Lawyer Recommendations
6. Next Steps`

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: summaryPrompt,
          sessionId: currentSession?.id,
          userId: user.id
        })
      })

      const data = await response.json()

      const summaryMessage = {
        role: 'assistant',
        content: `**📋 Complete Case Summary**\n\n${data.response}`,
        isSummary: true,
        timestamp: new Date().toISOString()
      }
      
      setMessages(prev => [...prev, summaryMessage])
      
      // Save summary message to database
      await supabase.from('chat_messages').insert([{
        session_id: currentSession.id,
        role: 'assistant',
        content: summaryMessage.content,
        metadata: {
          isSummary: true,
          stage: 4
        }
      }])
    } catch (error) {
      console.error('Error generating summary:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  return (
    <div className="chat-area">
      {/* Header */}
      <div className="chat-header glass">
        <div className="header-left">
          <button className="menu-btn" onClick={onToggleProgress}>
            ☰
          </button>
          <h1>⚖️ AI Justice Assistant</h1>
          <span className="stage-badge">Stage {currentStage}/4</span>
        </div>
        <div className="header-right">
          <button className="menu-btn" onClick={onToggleHistory}>
            📋
          </button>
          <div className="settings-dropdown">
            <button className="menu-btn" onClick={() => setShowSettings(!showSettings)}>
              ⚙️
            </button>
            {showSettings && (
              <div className="dropdown-menu glass">
                <button onClick={handleLogout}>
                  🚪 Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-container" ref={messagesContainerRef}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '⚖️'}
            </div>
            <div className="message-content">
              {msg.attachment && (
                <div className="message-attachment">
                  {msg.attachment.kind === 'image' && msg.attachment.previewUrl ? (
                    <img
                      src={msg.attachment.previewUrl}
                      alt={msg.attachment.name}
                      className="message-attachment-image"
                    />
                  ) : (
                    <div className="message-attachment-chip">
                      <span className="message-attachment-icon">📎</span>
                      <div>
                        <div className="message-attachment-name">{msg.attachment.name}</div>
                        <div className="message-attachment-meta">
                          {msg.attachment.kind === 'image' ? 'Image' : 'Document'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {msg.content
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .split(/<strong>|<\/strong>/)
                  .map((part, i) => 
                    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                  )}
              </p>
              
              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="message-sources">
                  <small>
                    📚 Sources: {msg.sources.map((s) => {
                      const parts = [s.displayTitle || s.title]
                      if (s.sectionLabel) parts.push(s.sectionLabel)
                      return parts.join(' · ')
                    }).join(', ')}
                  </small>
                </div>
              )}

              {/* Courts */}
              {msg.courts && msg.courts.length > 0 && (
                <div className="court-cards">
                  {msg.courts.map((court, courtIdx) => (
                    <div key={courtIdx} className="court-card">
                      <h4>{court.name}</h4>
                      <p>📍 {court.city}, {court.jurisdiction}</p>
                      <p>⚖️ Type: {court.type}</p>
                      {court.address && <p>📫 {court.address}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Lawyers */}
              {msg.lawyers && msg.lawyers.length > 0 && (
                <>
                  {/* Platform Lawyers Section */}
                  {msg.lawyers.some(l => l.is_platform_lawyer) && (
                    <div className="lawyers-section">
                      <h4 className="lawyers-section-title">⭐ Platform Lawyers</h4>
                      <div className="lawyer-cards">
                        {msg.lawyers.filter(l => l.is_platform_lawyer).map((lawyer, lawyerIdx) => (
                          <div key={`platform-${lawyerIdx}`} className="lawyer-card platform">
                            <div className="lawyer-header">
                              <h4>{lawyer.name}</h4>
                              <span className="lawyer-badge platform">⭐ Platform</span>
                              <span className="lawyer-badge">{Math.round(lawyer.match_score)}% Match</span>
                            </div>
                            <div className="lawyer-details">
                              <p>📍 {lawyer.city}</p>
                              <p>⏱️ {lawyer.experience_years} years experience</p>
                              {lawyer.specialization && lawyer.specialization.length > 0 && (
                                <p>⚖️ {lawyer.specialization.join(', ')}</p>
                              )}
                              {lawyer.rating && (
                                <p>⭐ Rating: {lawyer.rating.toFixed(2)}/5.00</p>
                              )}
                              {lawyer.phone && (
                                <p>📱 {lawyer.phone}</p>
                              )}
                              {lawyer.email && (
                                <p>📧 {lawyer.email}</p>
                              )}
                            </div>
                            <div className="lawyer-actions">
                              <button 
                                className="lawyer-profile-btn"
                                onClick={() => navigate(`/lawyer/${lawyer.id}`)}
                              >
                                View Full Profile →
                              </button>
                              {lawyer.email && (
                                <a href={`mailto:${lawyer.email}`} className="lawyer-contact-btn email">
                                  Email
                                </a>
                              )}
                              {lawyer.phone && (
                                <a href={`tel:${lawyer.phone}`} className="lawyer-contact-btn phone">
                                  Call
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Network Lawyers Section */}
                  {msg.lawyers.some(l => !l.is_platform_lawyer) && (
                    <div className="lawyers-section">
                      {msg.lawyers.some(l => l.is_platform_lawyer) && (
                        <h4 className="lawyers-section-title">Other Recommended Lawyers</h4>
                      )}
                      <div className="lawyer-cards">
                        {msg.lawyers.filter(l => !l.is_platform_lawyer).map((lawyer, lawyerIdx) => (
                          <div key={`network-${lawyerIdx}`} className="lawyer-card">
                            <div className="lawyer-header">
                              <h4>{lawyer.name}</h4>
                              <span className="lawyer-badge">{Math.round(lawyer.match_score)}% Match</span>
                            </div>
                            <div className="lawyer-details">
                              <p>📍 {lawyer.city}</p>
                              <p>⏱️ {lawyer.experience_years} years experience</p>
                              {lawyer.specialization && lawyer.specialization.length > 0 && (
                                <p>⚖️ {lawyer.specialization.join(', ')}</p>
                              )}
                            </div>
                            {lawyer.profile_link && (
                              <a 
                                href={lawyer.profile_link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="lawyer-profile-link"
                              >
                                View Profile →
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {msg.showMoreLawyers && (
                    <button 
                      className="show-more-btn btn-glow" 
                      onClick={() => showMoreLawyers(idx)}
                      style={{ marginTop: '10px' }}
                    >
                      Show More Lawyers ({msg.totalLawyers - msg.lawyers.length} more available)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {/* Stage Action Buttons */}
        {!loading && currentStage === 1 && lastAssistantOutOfDomain && (
          <div className="stage-action">
            <div style={{ 
              padding: '16px', 
              background: 'rgba(239, 68, 68, 0.1)', 
              border: '1px solid #ef4444', 
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              ⚠️ This case is outside our domain. Please ask a question related to Pakistani Civil, Criminal, or Family law to proceed.
            </div>
          </div>
        )}
        {!loading && currentStage === 1 && progress.caseProblem && !lastAssistantOutOfDomain && (
          <div className="stage-action">
            <button className="proceed-btn btn-glow" onClick={proceedToStage2}>
              Proceed to Stage 2: Court Recommendations →
            </button>
          </div>
        )}

        {!loading && currentStage === 2 && caseData.courts && (
          <div className="stage-action">
            <button className="proceed-btn btn-glow" onClick={proceedToStage3}>
              Proceed to Stage 3: Lawyer Recommendations →
            </button>
          </div>
        )}

        {!loading && currentStage === 3 && caseData.lawyers && (
          <div className="stage-action">
            <button className="finish-btn btn-glow" onClick={generateSummary}>
              ✓ Finish Consultation & Get Summary
            </button>
          </div>
        )}

        {!loading && currentStage === 4 && (
          <div className="stage-action">
            <button className="finish-btn btn-glow" onClick={() => setCurrentSession(null)}>
              ✓ Start New Consultation
            </button>
          </div>
        )}

        {loading && (
          <div className="message assistant">
            <div className="message-avatar">⚖️</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input glass">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: 'none' }}
        />
        <button 
          className="file-upload-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload PDF, DOC, or image file"
          disabled={loading || currentStage === 4}
        >
          📎
        </button>
        {selectedAttachment && (
          <div className="composer-attachment">
            {selectedAttachment.kind === 'image' && selectedAttachment.previewUrl ? (
              <img
                src={selectedAttachment.previewUrl}
                alt={selectedAttachment.name}
                className="composer-attachment-preview"
              />
            ) : (
              <span className="composer-attachment-icon">📎</span>
            )}
            <div className="composer-attachment-info">
              <span className="composer-attachment-name">{selectedAttachment.name}</span>
              <span className="composer-attachment-meta">
                {selectedAttachment.kind === 'image' ? 'Image ready to send' : 'Document ready to send'}
              </span>
            </div>
            <button
              type="button"
              className="composer-attachment-remove"
              onClick={clearSelectedAttachment}
              aria-label="Remove attachment"
            >
              ×
            </button>
          </div>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={currentStage === 4 ? "Consultation complete" : "Type your message here..."}
          disabled={loading || currentStage === 4}
        />
        <button 
          className="send-btn btn-glow" 
          onClick={handleSend}
          disabled={loading || (!input.trim() && !selectedAttachment) || currentStage === 4}
        >
          Send ➤
        </button>
      </div>
    </div>
  )
}
