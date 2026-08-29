// Görünür boyutlandırma tutamağı — yüzen pencerelerin sağ-alt köşesinde
// react-rnd'nin bottomRight resize handle'ının içine çizilir. Yalnızca görsel
// bir ipucu; tüm resize olayları react-rnd tarafından yönetilmeye devam eder.
export const ResizeGrip = ({ testId }) => (
  <div
    data-testid={testId ? `resize-grip-${testId}` : "resize-grip"}
    title="Boyutlandır"
    className="text-sertex-cyan/45 hover:text-sertex-cyan transition-colors"
    style={{
      position: "absolute",
      right: 4,
      bottom: 4,
      width: 18,
      height: 18,
      cursor: "nwse-resize",
    }}
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{ filter: "drop-shadow(0 0 3px currentColor)" }}
    >
      <line x1="17" y1="6" x2="6" y2="17" />
      <line x1="17" y1="11" x2="11" y2="17" />
      <line x1="17" y1="16" x2="16" y2="17" />
    </svg>
  </div>
);

export default ResizeGrip;
