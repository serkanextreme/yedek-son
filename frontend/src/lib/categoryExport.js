// İş Kolu (kategori) tamamlanma raporu dışa aktarma — Excel (SheetJS) ve
// Yazdır/PDF (tarayıcı). Rakamlar rollup'tur: her iş kolu kendisi + tüm alt
// kollarını kapsar. En üstte genel özet satırı yer alır.
import * as XLSX from "xlsx";
import { flattenTree, rollupCategoryStats, getCategoryPathLabel } from "./categoryTree";

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// grouped: [[companyIdOrKey, categories[]], ...] · stats: {catId:{total,done}}
// companyNameOf: (cid) => "Şirket Adı". Dönüş: { companies:[{name, lines, subtotal}], summary }.
function buildReport(grouped, stats, companyNameOf) {
  const companies = [];
  let sumTotal = 0;
  let sumDone = 0;
  for (const [cid, cats] of grouped) {
    const rollup = rollupCategoryStats(stats, cats);
    const flat = flattenTree(cats); // DFS + __depth
    let cTotal = 0;
    let cDone = 0;
    for (const c of cats) {
      const d = stats[c.id];
      if (d) {
        cTotal += d.total || 0;
        cDone += d.done || 0;
      }
    }
    sumTotal += cTotal;
    sumDone += cDone;
    const lines = flat.map((c) => {
      const r = rollup[c.id] || { total: 0, done: 0, pct: 0 };
      return {
        name: c.name,
        path: getCategoryPathLabel(c.id, cats),
        depth: c.__depth || 0,
        total: r.total,
        done: r.done,
        pct: r.pct,
      };
    });
    companies.push({
      name: companyNameOf(cid),
      lines,
      subtotal: { total: cTotal, done: cDone, pct: cTotal ? Math.round((cDone / cTotal) * 100) : 0 },
    });
  }
  return {
    companies,
    summary: { total: sumTotal, done: sumDone, pct: sumTotal ? Math.round((sumDone / sumTotal) * 100) : 0 },
  };
}

// ---------------------------------------------------------------------------
// EXCEL (.xlsx)
// ---------------------------------------------------------------------------
export const exportCategoryReportExcel = (grouped, stats, companyNameOf) => {
  const { companies, summary } = buildReport(grouped, stats, companyNameOf);
  const rows = [];
  rows.push({
    "Şirket": "TÜM ŞİRKETLER (ÖZET)",
    "İş Kolu": "",
    "Toplam Görev": summary.total,
    "Tamamlanan": summary.done,
    "Kalan": summary.total - summary.done,
    "Tamamlanma %": summary.pct,
  });
  for (const co of companies) {
    for (const l of co.lines) {
      rows.push({
        "Şirket": co.name,
        "İş Kolu": "  ".repeat(l.depth) + l.name,
        "Toplam Görev": l.total,
        "Tamamlanan": l.done,
        "Kalan": l.total - l.done,
        "Tamamlanma %": l.pct,
      });
    }
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["Şirket", "İş Kolu", "Toplam Görev", "Tamamlanan", "Kalan", "Tamamlanma %"],
  });
  ws["!cols"] = [{ wch: 24 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "İş Kolu Raporu");
  XLSX.writeFile(wb, `Sertex-IsKolu-Raporu-${stamp()}.xlsx`);
};

// ---------------------------------------------------------------------------
// YAZDIR / PDF — tarayıcı yazdırma penceresi
// ---------------------------------------------------------------------------
const bar = (pct) => `
  <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
  <span class="pct">%${pct}</span>`;

const companyBlock = (co) => `
  <section class="company">
    <div class="company-head">
      <span class="company-name">${esc(co.name)}</span>
      <span class="company-sub">${co.subtotal.done}/${co.subtotal.total} tamamlandı · %${co.subtotal.pct}</span>
    </div>
    <table>
      <thead><tr><th>İş Kolu</th><th class="num">Toplam</th><th class="num">Tamamlanan</th><th class="num">Kalan</th><th class="prog">Tamamlanma</th></tr></thead>
      <tbody>
        ${co.lines
          .map(
            (l) => `<tr>
              <td style="padding-left:${8 + l.depth * 18}px">${l.depth ? "› " : ""}${esc(l.name)}</td>
              <td class="num">${l.total}</td>
              <td class="num">${l.done}</td>
              <td class="num">${l.total - l.done}</td>
              <td class="prog">${bar(l.pct)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </section>`;

export const printCategoryReport = (grouped, stats, companyNameOf) => {
  const { companies, summary } = buildReport(grouped, stats, companyNameOf);
  const heading = "İş Kolu Tamamlanma Raporu";
  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${esc(heading)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; }
      .report-head { border-bottom: 2px solid #0a7ea4; padding-bottom: 8px; margin-bottom: 16px; }
      .report-head .brand { font-size: 20px; font-weight: 700; letter-spacing: 2px; color: #0a7ea4; }
      .report-head .sub { font-size: 12px; color: #555; }
      .summary { background: #f2f7f9; border: 1px solid #d6e6ec; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; }
      .summary .big { font-size: 22px; font-weight: 700; color: #0a7ea4; }
      .summary .lbl { font-size: 12px; color: #555; }
      .company { margin-bottom: 20px; page-break-inside: avoid; }
      .company-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 6px; }
      .company-name { font-size: 15px; font-weight: 700; color: #0a7ea4; }
      .company-sub { font-size: 12px; color: #555; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #e6e6e6; padding: 5px 8px; text-align: left; }
      thead th { background: #f7fafb; color: #333; }
      td.num, th.num { text-align: right; width: 80px; }
      th.prog, td.prog { width: 180px; }
      .bar { display: inline-block; width: 110px; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; vertical-align: middle; }
      .bar .fill { height: 100%; background: #22c55e; }
      .pct { font-size: 11px; color: #444; margin-left: 6px; }
      @media print { body { margin: 12mm; } }
    </style></head>
    <body>
      <div class="report-head">
        <div class="brand">SERTEX</div>
        <div class="sub">${esc(heading)} · ${esc(new Date().toLocaleString("tr-TR"))}</div>
      </div>
      <div class="summary">
        <span class="big">${summary.done}/${summary.total}</span>
        <span class="lbl"> görev tamamlandı · genel tamamlanma %${summary.pct}</span>
      </div>
      ${companies.map(companyBlock).join("")}
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
    </body></html>`;
  const win = window.open("", "_blank");
  if (!win) throw new Error("popup-blocked");
  win.document.open();
  win.document.write(html);
  win.document.close();
};
