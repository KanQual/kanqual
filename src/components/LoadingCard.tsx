import startupLogo from "../assets/logo-mark-no-background.png";
import loadingLogo from "../assets/logo-outline.png";
import { useI18n } from "../i18n/provider";

type LoadingCardProps = {
  startupIntro?: boolean;
  version?: string;
};

export function LoadingCard({ startupIntro = false, version }: LoadingCardProps) {
  const { t } = useI18n();

  return (
    <div className={`auth-card loading-card${startupIntro ? " loading-card--startup-intro" : ""}`} role="status" aria-live="polite">
      {!startupIntro ? <img src={loadingLogo} alt="" className="loading-card-bg-logo" aria-hidden="true" /> : null}
      {startupIntro ? <img src={startupLogo} alt="" className="loading-card-intro-logo" aria-hidden="true" /> : null}
      <div className={`loading-card-content${startupIntro ? " loading-card-content--startup-intro" : ""}`}>
        {startupIntro ? (
          <>
            <p className="loading-card-title">{t("app.loadingCard.productName")}</p>
            <p className="loading-card-version">{t("app.loadingCard.version", { version: version ?? "" })}</p>
            <p className="loading-card-description">
              {t("app.loadingCard.description")}
            </p>
            <p className="loading-card-byline">{t("app.loadingCard.byline")}</p>
          </>
        ) : (
          <>
            <p className="loading-card-title">{t("app.loadingCard.loading")}</p>
            <span className="auth-starting-spinner" aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  );
}
