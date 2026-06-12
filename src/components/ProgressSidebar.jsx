import '../styles/Sidebar.css'

export default function ProgressSidebar({ show, onClose, progress, isMobile }) {
  return (
    <div className={`sidebar progress-sidebar ${show ? 'show' : ''} ${isMobile ? 'mobile' : ''}`}>
      <div className="sidebar-header">
        <h2>Progress</h2>
        {isMobile && (
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      <div className="progress-steps">
        <div className={`progress-step ${progress.caseProblem ? 'completed' : 'active'}`}>
          <div className="step-icon">
            {progress.caseProblem ? '✓' : '1'}
          </div>
          <div className="step-content">
            <h3>Case / Problem</h3>
            <p>Describe your legal issue</p>
          </div>
        </div>

        <div className={`progress-step ${progress.caseCategory ? 'completed' : progress.caseProblem ? 'active' : ''}`}>
          <div className="step-icon">
            {progress.caseCategory ? '✓' : '2'}
          </div>
          <div className="step-content">
            <h3>Court Recommendations</h3>
            <p>Analysis & court suggestions</p>
          </div>
        </div>

        <div className={`progress-step ${progress.lawyerProvision ? 'completed' : progress.caseCategory ? 'active' : ''}`}>
          <div className="step-icon">
            {progress.lawyerProvision ? '✓' : '3'}
          </div>
          <div className="step-content">
            <h3>Lawyer Recommendations</h3>
            <p>Get matched with lawyers</p>
          </div>
        </div>

        <div className={`progress-step ${progress.summary ? 'completed' : progress.lawyerProvision ? 'active' : ''}`}>
          <div className="step-icon">
            {progress.summary ? '✓' : '4'}
          </div>
          <div className="step-content">
            <h3>Summary</h3>
            <p>Complete case overview</p>
          </div>
        </div>
      </div>
    </div>
  )
}
