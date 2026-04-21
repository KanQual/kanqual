import { useStore } from "../context/StoreContext";

export function CodersView() {
  const {} = useStore();

  return (
    <div className="view">
      <header className="view-header">
        <h1>Coders Report</h1>
      </header>
      
      <div className="empty-state">
        <p className="empty-state-title">Coders Report</p>
        <p className="empty-state-subtitle">Coming soon. Compare how different team members have coded documents.</p>
      </div>
    </div>
  );
}
