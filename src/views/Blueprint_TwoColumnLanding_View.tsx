import { useEffect, useRef, useState } from "react";

function LandingStatCard({
  title,
}: {
  title: string;
}) {
  return (
    <article className="home-stat-card blueprint-landing-stat-card">
      <div className="home-stat-title">{title}</div>
      <div className="home-stat-count">Stat Value</div>
      <div className="home-stat-details">
        <div className="home-stat-row">
          <span className="home-stat-label">Detail Label</span>
          <span className="home-stat-value">Detail Value</span>
        </div>
        <div className="home-stat-row">
          <span className="home-stat-label">Detail Label</span>
          <span className="home-stat-value">Detail Value</span>
        </div>
        <div className="home-stat-row">
          <span className="home-stat-label">Detail Label</span>
          <span className="home-stat-value">Detail Value</span>
        </div>
      </div>
    </article>
  );
}

export function BlueprintTwoColumnLandingView() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function syncMenuPosition() {
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - 180),
      });
    }

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    syncMenuPosition();
    window.addEventListener("resize", syncMenuPosition);
    document.addEventListener("scroll", syncMenuPosition, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", syncMenuPosition);
      document.removeEventListener("scroll", syncMenuPosition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="view home-view blueprint-landing-view">
      <header className="view-header">
        <div>
          <div className="blueprint-eyebrow">View Header</div>
          <h1>Page Title</h1>
        </div>
        <button
          ref={menuButtonRef}
          className="btn home-menu-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Header menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {menuOpen && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menuPos.top, left: menuPos.left, minWidth: 180 }}
          role="menu"
        >
          <button className="context-menu-item" type="button" onClick={() => setMenuOpen(false)}>
            Project Settings
          </button>
          <button className="context-menu-item context-menu-item--danger" type="button" onClick={() => setMenuOpen(false)}>
            Delete Project
          </button>
        </div>
      )}

      <div className="home-dashboard">
        <div className="blueprint-landing-primary-column">
          <section className="home-project-card blueprint-landing-hero" aria-label="Primary column">
            <div className="home-project-card-header">
              <h2>Primary Card Title</h2>
            </div>
            <p className="home-project-description">Primary Card Description</p>
          </section>

          <section className="home-project-card blueprint-landing-secondary-card" aria-label="Restricted information card">
            <div className="home-project-card-header">
              <h2>Restricted Information Card Title</h2>
            </div>
            <div className="blueprint-landing-restricted-list">
              <div className="blueprint-landing-restricted-item">Restricted Information Item</div>
              <div className="blueprint-landing-restricted-item">Restricted Information Item</div>
              <div className="blueprint-landing-restricted-item">Restricted Information Item</div>
            </div>
          </section>
        </div>

        <div className="home-stats-grid blueprint-landing-grid">
          <LandingStatCard title="Stat Card" />
          <LandingStatCard title="Stat Card" />
          <LandingStatCard title="Stat Card" />
          <LandingStatCard title="Stat Card" />
          <LandingStatCard title="Stat Card" />
          <LandingStatCard title="Stat Card" />
        </div>
      </div>
    </div>
  );
}
