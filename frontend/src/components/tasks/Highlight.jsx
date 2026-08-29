import React from "react";

// Arama eşleşmelerini sarı <mark> ile vurgular. Türkçe duyarlı (toLocaleLowerCase
// "tr") — arama filtresiyle birebir aynı eşleşme mantığı. query boşsa metni
// olduğu gibi döndürür (sıfır davranış değişikliği).
export const Highlight = ({ text, query }) => {
  const t = text == null ? "" : String(text);
  const q = (query || "").trim();
  if (!q) return <>{t}</>;
  const lt = t.toLocaleLowerCase("tr");
  const lq = q.toLocaleLowerCase("tr");
  // Türkçe küçültme uzunluğu koruduğu için indeksler orijinal metinle hizalı.
  if (lt.length !== t.length) return <>{t}</>;
  const out = [];
  let i = 0;
  let idx;
  let key = 0;
  while ((idx = lt.indexOf(lq, i)) !== -1) {
    if (idx > i) out.push(<React.Fragment key={key++}>{t.slice(i, idx)}</React.Fragment>);
    out.push(
      <mark
        key={key++}
        className="bg-yellow-300 text-black rounded-sm px-0.5"
      >
        {t.slice(idx, idx + lq.length)}
      </mark>,
    );
    i = idx + lq.length;
  }
  if (out.length === 0) return <>{t}</>;
  if (i < t.length) out.push(<React.Fragment key={key++}>{t.slice(i)}</React.Fragment>);
  return <>{out}</>;
};

export default Highlight;
