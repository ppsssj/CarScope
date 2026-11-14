// 차보담 user-facing brand. Internal ids, packages, API paths and the QR
// contract keep the CarScope name for compatibility.
export const SERVICE_NAME = "차보담";
export const BRAND_MESSAGE =
  "내 차를 알아가고, 직접 살펴보며, 오래도록 아껴 타는 경험";

export function BrandBar({ label }: { label?: string }) {
  return (
    <header className="cb-brandbar">
      <a href="/" className="cb-wordmark" aria-label={`${SERVICE_NAME} 홈`}>
        <span className="cb-wordmark-mark" aria-hidden="true" />
        {SERVICE_NAME}
      </a>
      {label && <span className="cb-brandbar-label">{label}</span>}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="cb-footer">
      <strong>{SERVICE_NAME}</strong>
      <p>{BRAND_MESSAGE}</p>
    </footer>
  );
}
