// Mobil İş Kolu (kategori) tamamlanma raporu — PDF (expo-print) ve Excel
// (xlsx) üretir, expo-sharing ile paylaşır. Veri /team/category-summary'den.
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";

import { TeamCategoryRow } from "@/src/api/types";

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

const pctOf = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function totals(rows: TeamCategoryRow[]) {
  const total = rows.reduce((a, r) => a + r.total, 0);
  const done = rows.reduce((a, r) => a + r.done, 0);
  const overdue = rows.reduce((a, r) => a + r.overdue, 0);
  return { total, done, overdue, pct: pctOf(done, total) };
}

export async function shareCategoryReportPdf(rows: TeamCategoryRow[]) {
  const t = totals(rows);
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.name)}</td>
        <td class="num">${r.total}</td>
        <td class="num">${r.done}</td>
        <td class="num">${r.pending}</td>
        <td class="num">${r.overdue}</td>
        <td class="num">%${pctOf(r.done, r.total)}</td>
      </tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;}
      .head{border-bottom:2px solid #0a7ea4;padding-bottom:8px;margin-bottom:14px;}
      .brand{font-size:22px;font-weight:700;letter-spacing:2px;color:#0a7ea4;}
      .sub{font-size:12px;color:#555;}
      .summary{background:#f2f7f9;border:1px solid #d6e6ec;border-radius:6px;padding:10px 14px;margin-bottom:16px;}
      .big{font-size:22px;font-weight:700;color:#0a7ea4;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #e6e6e6;padding:6px 8px;text-align:left;}
      thead th{background:#f7fafb;}
      td.num,th.num{text-align:right;}
    </style></head><body>
      <div class="head"><div class="brand">SERTEX</div>
      <div class="sub">İş Kolu Tamamlanma Raporu · ${esc(new Date().toLocaleString("tr-TR"))}</div></div>
      <div class="summary"><span class="big">${t.done}/${t.total}</span>
      <span> görev tamamlandı · genel %${t.pct} · ${t.overdue} geciken</span></div>
      <table><thead><tr><th>İş Kolu</th><th class="num">Toplam</th><th class="num">Tamam</th>
      <th class="num">Açık</th><th class="num">Geciken</th><th class="num">%</th></tr></thead>
      <tbody>${body}</tbody></table>
    </body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "İş Kolu Raporu" });
  }
}

export async function shareCategoryReportExcel(rows: TeamCategoryRow[]) {
  const t = totals(rows);
  const data = [
    { "İş Kolu": "GENEL ÖZET", Toplam: t.total, Tamamlanan: t.done, "Açık": "", Geciken: t.overdue, "Tamamlanma %": t.pct },
    ...rows.map((r) => ({
      "İş Kolu": r.name,
      Toplam: r.total,
      Tamamlanan: r.done,
      "Açık": r.pending,
      Geciken: r.overdue,
      "Tamamlanma %": pctOf(r.done, r.total),
    })),
  ];
  const ws = XLSX.utils.json_to_sheet(data, {
    header: ["İş Kolu", "Toplam", "Tamamlanan", "Açık", "Geciken", "Tamamlanma %"],
  });
  ws["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "İş Kolu Raporu");
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const uri = `${FileSystem.cacheDirectory}Sertex-IsKolu-Raporu-${stamp()}.xlsx`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dialogTitle: "İş Kolu Raporu (Excel)",
    });
  }
}
