import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import '../styles/LawyerProfile.css'

export default function LawyerProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [lawyer, setLawyer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    fetchLawyer()
  }, [id])

  const fetchLawyer = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('lawyers')
        .select('*')
        .eq('id', id)
        .single()

      if (fetchError) {
        throw fetchError
      }

      setLawyer(data)
    } catch (err) {
      console.error('Error fetching lawyer:', err)
      setError('Lawyer not found')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text)
    setCopied(field)
    setTimeout(() => setCopied(''), 2000)
  }

  const getSpecializationLabel = (spec) => {
    const labels = {
      civil: 'Civil Law',
      criminal: 'Criminal Law',
      family: 'Family Law'
    }
    return labels[spec] || spec
  }

  const handleLogout = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  if (loading) {
    return (
      <div className="lawyer-profile-container">
        <div className="loading">Loading lawyer profile...</div>
      </div>
    )
  }

  if (error || !lawyer) {
    return (
      <div className="lawyer-profile-container">
        <div className="error-message">
          <h2>❌ {error || 'Lawyer not found'}</h2>
          <button className="btn-back" onClick={() => navigate('/chat')}>
            Go Back to Chat
          </button>
        </div>
      </div>
    )
  }

  const ratingPercentage = (lawyer.rating / 5) * 100
  const successRate = Number(lawyer.success_rate) || 0

  return (
    <div className="lawyer-profile-container">
      <button className="btn-back" onClick={handleLogout}>
        Logout
      </button>

      <div className="lawyer-profile">
        {/* Platform Lawyer Badge */}
        {lawyer.is_platform_lawyer && (
          <div className="platform-badge">
            ⭐ Platform Lawyer
          </div>
        )}

        {/* Header Section */}
        <div className="lawyer-header">
          <div className="lawyer-avatar">
            {lawyer.name.charAt(0).toUpperCase()}
          </div>
          <div className="lawyer-info-header">
            <h1>{lawyer.name}</h1>
            <p className="lawyer-location">📍 {lawyer.city}</p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="lawyer-content">
          {/* Left Column - Key Information */}
          <div className="lawyer-main">
            {/* Contact Information */}
            <section className="profile-section">
              <h2>📞 Contact Information</h2>
              <div className="contact-info">
                <div className="contact-item">
                  <label>Email</label>
                  <div className="contact-value">
                    <span>{lawyer.email}</span>
                    <button 
                      className="copy-btn"
                      onClick={() => copyToClipboard(lawyer.email, 'email')}
                      title="Copy to clipboard"
                    >
                      {copied === 'email' ? '✓ Copied' : '📋'}
                    </button>
                  </div>
                </div>

                <div className="contact-item">
                  <label>Phone</label>
                  <div className="contact-value">
                    <span>{lawyer.phone}</span>
                    <button 
                      className="copy-btn"
                      onClick={() => copyToClipboard(lawyer.phone, 'phone')}
                      title="Copy to clipboard"
                    >
                      {copied === 'phone' ? '✓ Copied' : '📋'}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Specialization */}
            <section className="profile-section">
              <h2>⚖️ Specialization</h2>
              <div className="specialization-tags">
                {lawyer.specialization.map(spec => (
                  <span key={spec} className="tag">
                    {getSpecializationLabel(spec)}
                  </span>
                ))}
              </div>
            </section>

            {/* Professional Experience */}
            <section className="profile-section">
              <h2>💼 Professional Experience</h2>
              <div className="experience-grid">
                <div className="experience-item">
                  <div className="experience-label">Years of Experience</div>
                  <div className="experience-value">{lawyer.experience_years} years</div>
                </div>
                <div className="experience-item">
                  <div className="experience-label">Total Cases</div>
                  <div className="experience-value">{lawyer.total_cases}</div>
                </div>
                <div className="experience-item">
                  <div className="experience-label">Success Rate</div>
                  <div className="experience-value">{successRate}%</div>
                </div>
              </div>
            </section>

            {/* Bar Council Information */}
            {lawyer.bar_council_id && (
              <section className="profile-section">
                <h2>📋 Bar Council Information</h2>
                <div className="bar-council">
                  <strong>Registration ID:</strong> {lawyer.bar_council_id}
                </div>
              </section>
            )}

            {/* Profile Link */}
            {(lawyer.profile_link || lawyer.profile_url) && (
              <section className="profile-section">
                <h2>🔗 Profile Link</h2>
                <a href={lawyer.profile_link || lawyer.profile_url} target="_blank" rel="noopener noreferrer" className="profile-link">
                  Visit Profile →
                </a>
              </section>
            )}
          </div>

          {/* Right Column - Rating & Scoring */}
          <div className="lawyer-sidebar">
            {/* Rating Section */}
            <section className="rating-section">
              <h3>Platform Rating</h3>
              <div className="rating-display">
                <div className="rating-circle">
                  <div className="rating-value">{lawyer.rating.toFixed(2)}</div>
                  <div className="rating-max">out of 5.00</div>
                </div>
                <div className="rating-bar">
                  <div 
                    className="rating-fill" 
                    style={{ width: `${ratingPercentage}%` }}
                  ></div>
                </div>
              </div>
            </section>

            {/* Score Breakdown */}
            <section className="score-section">
              <h3>Score Breakdown</h3>
              <div className="score-breakdown">
                <div className="score-component">
                  <div className="component-label">Experience</div>
                  <div className="component-bar">
                    <div 
                      className="component-fill experience"
                      style={{ width: `${Math.min((lawyer.experience_years / 20) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <div className="component-value">
                    {Math.round(Math.min(lawyer.experience_years / 20, 1) * 40)}/40
                  </div>
                </div>

                <div className="score-component">
                  <div className="component-label">Total Cases</div>
                  <div className="component-bar">
                    <div 
                      className="component-fill cases"
                      style={{ width: `${Math.min((lawyer.total_cases / 100) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <div className="component-value">
                    {Math.round(Math.min(lawyer.total_cases / 100, 1) * 35)}/35
                  </div>
                </div>

                <div className="score-component">
                  <div className="component-label">Success Rate</div>
                  <div className="component-bar">
                    <div 
                      className="component-fill success"
                      style={{ width: `${successRate}%` }}
                    ></div>
                  </div>
                  <div className="component-value">
                    {Math.round((successRate / 100) * 25)}/25
                  </div>
                </div>
              </div>
            </section>

            {/* Contact CTA */}
            <section className="contact-cta">
              <h3>Contact This Lawyer</h3>
              <div className="contact-buttons">
                <a href={`mailto:${lawyer.email}`} className="btn-contact email">
                  📧 Email
                </a>
                <a href={`tel:${lawyer.phone}`} className="btn-contact phone">
                  📱 Call
                </a>
              </div>
            </section>

            {/* Additional Info */}
            <div className="additional-info">
              <small>Member since {new Date(lawyer.created_at).toLocaleDateString()}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
