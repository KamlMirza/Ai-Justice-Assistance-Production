import { useState } from 'react'
import '../styles/PhaseCard.css'

export default function PhaseCard({ phase, onClose, userId }) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleClose = () => {
    if (dontShowAgain && userId) {
      // Store preference in localStorage with user ID
      const hidePhaseCards = JSON.parse(localStorage.getItem('hidePhaseCards') || '{}')
      hidePhaseCards[userId] = true
      localStorage.setItem('hidePhaseCards', JSON.stringify(hidePhaseCards))
    }
    onClose()
  }

  const phaseInfo = {
    1: {
      title: 'Phase 1: Describe Your Case',
      icon: '📝',
      description: 'Tell us about your legal problem in detail',
      instructions: [
        'Describe what happened in your own words',
        'Include dates, locations, and people involved',
        'Mention any documents or evidence you have',
        'Be as specific as possible for better assistance'
      ],
      example: 'Example: "I was in a car accident on Main Street last week. The other driver ran a red light and hit my vehicle. I have minor injuries and my car is damaged. I have photos and a police report."'
    },
    2: {
      title: 'Phase 2: Case Classification',
      icon: '⚖️',
      description: 'Our AI analyzes and categorizes your case',
      instructions: [
        'AI reads your case description',
        'Classifies it as Civil, Criminal, or Family law',
        'Provides confidence score and reasoning',
        'Helps determine the right legal path'
      ],
      example: 'Your case will be automatically classified based on Pakistani law. For example, property disputes are Civil, theft is Criminal, and divorce is Family law.'
    },
    3: {
      title: 'Phase 3: Lawyer Recommendations',
      icon: '👨‍⚖️',
      description: 'Get matched with qualified lawyers',
      instructions: [
        'AI finds lawyers specializing in your case type',
        'Matches based on experience and ratings',
        'Shows lawyers in your city (Karachi)',
        'Provides match scores to help you choose'
      ],
      example: 'You\'ll see top 3 lawyers with their experience, specializations, and contact information. Higher match scores mean better fit for your case.'
    }
  }

  const info = phaseInfo[phase]

  if (!info) return null

  return (
    <div className="phase-card-overlay" onClick={handleClose}>
      <div className="phase-card glass fade-in" onClick={(e) => e.stopPropagation()}>
        <button className="phase-card-close" onClick={handleClose}>✕</button>
        
        <div className="phase-card-header">
          <div className="phase-icon">{info.icon}</div>
          <h2>{info.title}</h2>
          <p>{info.description}</p>
        </div>

        <div className="phase-card-content">
          <h3>How it works:</h3>
          <ul className="phase-instructions">
            {info.instructions.map((instruction, idx) => (
              <li key={idx}>
                <span className="step-number">{idx + 1}</span>
                <span>{instruction}</span>
              </li>
            ))}
          </ul>

          <div className="phase-example">
            <h4>💡 Example:</h4>
            <p>{info.example}</p>
          </div>
        </div>

        <div className="phase-card-footer">
          <label className="dont-show-checkbox">
            <input 
              type="checkbox" 
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don't show phase instructions again</span>
          </label>
          <button className="btn-primary btn-glow" onClick={handleClose}>
            Got it!
          </button>
        </div>
      </div>
    </div>
  )
}
