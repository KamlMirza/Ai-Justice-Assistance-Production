import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../styles/LawyerSignup.css'

export default function LawyerSignup() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    city: '',
    experience_years: '',
    specialization: [],
    barCouncilId: '',
    profileUrl: '',
    totalCases: '',
    successRate: ''
  })

  const specializationOptions = [
    { value: 'civil', label: 'Civil Law' },
    { value: 'criminal', label: 'Criminal Law' },
    { value: 'family', label: 'Family Law' }
  ]

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSpecializationChange = (value) => {
    setFormData(prev => ({
      ...prev,
      specialization: prev.specialization.includes(value)
        ? prev.specialization.filter(s => s !== value)
        : [...prev.specialization, value]
    }))
  }

  const calculateScore = () => {
    const experienceYears = parseInt(formData.experience_years) || 0
    const totalCases = parseInt(formData.totalCases) || 0
    const successRate = parseFloat(formData.successRate) || 0

    let score = 0

    // Experience weight (40%) - 1 point per year up to 20
    score += Math.min(experienceYears / 20, 1) * 40

    // Total cases weight (35%) - normalize to 100 cases
    score += Math.min(totalCases / 100, 1) * 35

    // Success rate weight (25%)
    score += (successRate / 100) * 25

    return Math.round(score)
  }

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError('Name is required')
      return false
    }
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError('Valid email is required')
      return false
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters')
      return false
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return false
    }
    if (!formData.phone.trim()) {
      setError('Phone number is required')
      return false
    }
    if (!formData.city.trim()) {
      setError('City is required')
      return false
    }
    if (!formData.experience_years || parseInt(formData.experience_years) < 0) {
      setError('Valid experience years is required')
      return false
    }
    if (formData.specialization.length === 0) {
      setError('Select at least one specialization')
      return false
    }
    if (!formData.totalCases || parseInt(formData.totalCases) < 0) {
      setError('Valid total cases is required')
      return false
    }
    if (!formData.successRate || parseFloat(formData.successRate) < 0 || parseFloat(formData.successRate) > 100) {
      setError('Success rate must be between 0 and 100')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      const score = calculateScore()

      const { error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password,
        options: {
          data: {
            full_name: formData.name,
            role: 'lawyer'
          },
          emailRedirectTo: `${window.location.origin}/login`
        }
      })

      if (authError) {
        throw authError
      }

      // Insert lawyer into database
      const { data, error: insertError } = await supabase
        .from('lawyers')
        .insert([{
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          city: formData.city,
          experience_years: parseInt(formData.experience_years),
          specialization: formData.specialization,
          total_cases: parseInt(formData.totalCases),
          success_rate: parseFloat(formData.successRate),
          rating: score / 20, // Convert score to 0-5 scale
          bar_council_id: formData.barCouncilId || null,
          profile_link: formData.profileUrl || null,
          is_platform_lawyer: true,
          created_at: new Date().toISOString()
        }])
        .select()

      if (insertError) {
        throw insertError
      }

      setSuccess(true)
      setFormData({
        name: '',
        email: '',
        phone: '',
        city: '',
        experience_years: '',
        specialization: [],
        barCouncilId: '',
        profileUrl: '',
        totalCases: '',
        successRate: ''
      })
      setPassword('')
      setConfirmPassword('')

      // Redirect to lawyer profile after 2 seconds
      setTimeout(() => {
        navigate(`/lawyer/${data[0].id}`)
      }, 2000)
    } catch (err) {
      console.error('Signup error:', err)
      setError(err.message || 'Failed to sign up. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const score = calculateScore()

  return (
    <div className="lawyer-signup-container">
      <div className="lawyer-signup-form">
        <div className="form-header">
          <h1>⚖️ Join Our Lawyer Network</h1>
          <p>Register as a lawyer on our platform and get recommended to clients seeking legal assistance</p>
        </div>

        {success && (
          <div className="alert alert-success">
            ✅ Successfully registered! Redirecting to your profile...
          </div>
        )}

        {error && (
          <div className="alert alert-error">
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Personal Information */}
          <fieldset>
            <legend>Personal Information</legend>
            
            <div className="form-group">
              <label htmlFor="name">Full Name *</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Your full name"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="email">Email Address *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="your@email.com"
                  required
                />
                <small>Clients will contact you via this email</small>
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone Number *</label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="+92 XXX XXXXXXX"
                  required
                />
                <small>Clients will contact you via this number</small>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="password">Password *</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a login password"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <div className="password-input-wrapper">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
                <small>You will use this password to sign in at the login page.</small>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="city">City *</label>
                <input
                  type="text"
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="e.g., Karachi"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="barCouncilId">Bar Council ID</label>
                <input
                  type="text"
                  id="barCouncilId"
                  name="barCouncilId"
                  value={formData.barCouncilId}
                  onChange={handleChange}
                  placeholder="Optional: Your bar council registration"
                />
              </div>
            </div>
          </fieldset>

          {/* Professional Information */}
          <fieldset>
            <legend>Professional Information</legend>

            <div className="form-group">
              <label>Specialization *</label>
              <div className="checkbox-group">
                {specializationOptions.map(option => (
                  <label key={option.value} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.specialization.includes(option.value)}
                      onChange={() => handleSpecializationChange(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="experience_years">Years of Experience *</label>
                <input
                  type="number"
                  id="experience_years"
                  name="experience_years"
                  value={formData.experience_years}
                  onChange={handleChange}
                  min="0"
                  max="70"
                  placeholder="0"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="totalCases">Total Cases Handled *</label>
                <input
                  type="number"
                  id="totalCases"
                  name="totalCases"
                  value={formData.totalCases}
                  onChange={handleChange}
                  min="0"
                  placeholder="0"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="successRate">Success Rate (%) *</label>
                <input
                  type="number"
                  id="successRate"
                  name="successRate"
                  value={formData.successRate}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="0"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="profileUrl">Profile/Website URL</label>
              <input
                type="url"
                id="profileUrl"
                name="profileUrl"
                value={formData.profileUrl}
                onChange={handleChange}
                placeholder="https://yourprofile.com"
              />
            </div>
          </fieldset>

          {/* Score Preview */}
          <div className="score-preview">
            <h3>Platform Score Preview</h3>
            <div className="score-breakdown">
              <div className="score-item">
                <span>Experience ({formData.experience_years || 0} years):</span>
                <span className="score-value">{Math.round(Math.min(parseInt(formData.experience_years || 0) / 20, 1) * 40)}/40</span>
              </div>
              <div className="score-item">
                <span>Total Cases ({formData.totalCases || 0} cases):</span>
                <span className="score-value">{Math.round(Math.min(parseInt(formData.totalCases || 0) / 100, 1) * 35)}/35</span>
              </div>
              <div className="score-item">
                <span>Success Rate ({formData.successRate || 0}%):</span>
                <span className="score-value">{Math.round((parseFloat(formData.successRate || 0) / 100) * 25)}/25</span>
              </div>
              <div className="score-item total">
                <span>Total Score:</span>
                <span className="score-value total-value">{score}/100</span>
              </div>
              <div className="score-item total">
                <span>Rating (0-5 scale):</span>
                <span className="score-value total-value">{(score / 20).toFixed(2)}/5.00</span>
              </div>
            </div>
            <small>Your score helps clients find the best lawyer for their case. Higher scores appear higher in recommendations.</small>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Registering...' : 'Register as Platform Lawyer'}
            </button>
            <button 
              type="button" 
              className="btn-cancel" 
              onClick={() => navigate('/')}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
