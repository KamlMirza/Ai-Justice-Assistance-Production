import { Link } from 'react-router-dom'
import '../styles/Terms.css'

export default function Terms() {
  return (
    <div className="terms-container">
      <div className="terms-card glass">
        <div className="terms-header">
          <h1>Terms and Conditions</h1>
          <p>Last updated: December 13, 2024</p>
        </div>

        <div className="terms-content">
          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing and using the AI Justice Assistant platform, you accept and agree to be bound by the terms and provision of this agreement.
            </p>
          </section>

          <section>
            <h2>2. Use of Service</h2>
            <p>
              The AI Justice Assistant provides legal information and guidance based on Pakistani law. This service is for informational purposes only and does not constitute legal advice.
            </p>
            <ul>
              <li>You must be at least 18 years old to use this service</li>
              <li>You are responsible for maintaining the confidentiality of your account</li>
              <li>You agree to provide accurate and complete information</li>
            </ul>
          </section>

          <section>
            <h2>3. Legal Disclaimer</h2>
            <p>
              The information provided by AI Justice Assistant is not a substitute for professional legal advice. Always consult with a qualified lawyer for specific legal matters.
            </p>
          </section>

          <section>
            <h2>4. Privacy Policy</h2>
            <p>
              We respect your privacy and are committed to protecting your personal data. Your information is stored securely and will not be shared with third parties without your consent.
            </p>
          </section>

          <section>
            <h2>5. User Responsibilities</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the service for any illegal purposes</li>
              <li>Attempt to gain unauthorized access to the system</li>
              <li>Share your account credentials with others</li>
              <li>Misuse or abuse the AI assistant</li>
            </ul>
          </section>

          <section>
            <h2>6. Limitation of Liability</h2>
            <p>
              AI Justice Assistant and its operators shall not be liable for any damages arising from the use or inability to use the service.
            </p>
          </section>

          <section>
            <h2>7. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2>8. Contact Information</h2>
            <p>
              For questions about these terms, please contact us through the platform.
            </p>
          </section>
        </div>

        <div className="terms-footer">
          <Link to="/signup" className="btn-primary btn-glow">
            I Agree - Continue to Signup
          </Link>
        </div>
      </div>
    </div>
  )
}
