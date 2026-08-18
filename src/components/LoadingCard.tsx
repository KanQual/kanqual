import startupLogo from "../assets/logo-outline.png";

export function LoadingCard() {
  return (
    <div className="auth-card loading-card" role="status" aria-live="polite">
      <img src={startupLogo} alt="" className="loading-card-bg-logo" aria-hidden="true" />
      <div className="loading-card-content">
        <p className="loading-card-title">Loading</p>
        <span className="auth-starting-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
