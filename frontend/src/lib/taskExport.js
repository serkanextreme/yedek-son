// Görev dışa aktarma yardımcıları — Yazdır/PDF (tarayıcı), Excel (SheetJS), Word (.docx).
// Tek görev veya toplu liste için ortak kullanılır. Davranış saf: sadece dosya üretir/yazdırır.
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } from "docx";
import { saveAs } from "file-saver";

const STATUS_LABELS = {
  pending: "Aktif",
  done: "Tamamlandı",
  paused: "Beklemede",
  overdue: "Tarihi Geçmiş",
};

export const statusLabel = (s) => STATUS_LABELS[s] || (s || "—");

export const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    console.warn("[taskExport.js] tarih biçimlendirilemedi:", e);
    return String(iso);
  }
};

const subStatusLabel = (s) => {
  if (s.done || s.status === "done") return "Tamamlandı";
  if (s.status === "paused") return "Beklemede";
  return "Açık";
};

// Görev nesnesini düz alanlara indir. `categoryNameById` opsiyonel (id → isim).
export const buildTaskData = (task, categoryNameById = {}) => ({
  title: task.title || "",
  description: task.description || "",
  status: statusLabel(task.status),
  due_date: fmtDate(task.due_date),
  completed_at: task.status === "done" ? fmtDate(task.completed_at) : "—",
  assignee: task.assignee_name || "—",
  company: task.company_name || "—",
  category: categoryNameById[task.category_id] || "—",
  subtasks: (task.subtasks || []).map((s) => ({
    text: s.text || "",
    status: subStatusLabel(s),
    due_date: fmtDate(s.due_date),
  })),
});

const sanitizeFilename = (name) =>
  (name || "gorev")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "gorev";

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

// ---------------------------------------------------------------------------
// YAZDIR / PDF — tarayıcı yazdırma penceresi
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const taskPrintBlock = (d) => `
  <section class="task">
    <h2>${esc(d.title)}</h2>
    ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ""}
    <table class="meta">
      <tr><th>Durum</th><td>${esc(d.status)}</td><th>İş Kolu</th><td>${esc(d.category)}</td></tr>
      <tr><th>Son Tarih</th><td>${esc(d.due_date)}</td><th>Tamamlanma</th><td>${esc(d.completed_at)}</td></tr>
      <tr><th>Görev Sahibi</th><td>${esc(d.assignee)}</td><th>Şirket</th><td>${esc(d.company)}</td></tr>
    </table>
    ${
      d.subtasks.length
        ? `<div class="sub-title">Alt Görevler (${d.subtasks.length})</div>
           <table class="subs">
             <thead><tr><th>#</th><th>Alt Görev</th><th>Durum</th><th>Tarih</th></tr></thead>
             <tbody>
               ${d.subtasks
                 .map(
                   (s, i) =>
                     `<tr><td>${i + 1}</td><td>${esc(s.text)}</td><td>${esc(s.status)}</td><td>${esc(s.due_date)}</td></tr>`
                 )
                 .join("")}
             </tbody>
           </table>`
        : ""
    }
  </section>`;

export const printTasks = (tasks, categoryNameById = {}, opts = {}) => {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  const heading = opts.heading || (list.length > 1 ? `Görev Raporu (${list.length})` : "Görev Raporu");
  const body = list.map((t) => taskPrintBlock(buildTaskData(t, categoryNameById))).join("");
  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${esc(heading)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; }
      .report-head { border-bottom: 2px solid #0a7ea4; padding-bottom: 8px; margin-bottom: 16px; }
      .report-head .brand { font-size: 20px; font-weight: 700; letter-spacing: 2px; color: #0a7ea4; }
      .report-head .sub { font-size: 12px; color: #555; }
      .task { border: 1px solid #ddd; border-radius: 6px; padding: 14px 16px; margin-bottom: 16px; page-break-inside: avoid; }
      .task h2 { font-size: 16px; margin: 0 0 6px; color: #0a7ea4; }
      .task .desc { font-size: 13px; color: #333; margin: 0 0 10px; white-space: pre-wrap; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      table.meta th { text-align: left; color: #666; font-weight: 600; padding: 3px 8px 3px 0; width: 90px; white-space: nowrap; }
      table.meta td { padding: 3px 16px 3px 0; }
      .sub-title { font-size: 12px; font-weight: 700; margin: 10px 0 4px; color: #444; }
      table.subs th, table.subs td { border: 1px solid #e0e0e0; padding: 4px 8px; text-align: left; }
      table.subs thead th { background: #f2f7f9; color: #333; }
      @media print { body { margin: 12mm; } .no-print { display: none; } }
    </style></head>
    <body>
      <div class="report-head">
        <div class="brand">SERTEX</div>
        <div class="sub">${esc(heading)} · ${esc(new Date().toLocaleString("tr-TR"))}</div>
      </div>
      ${body}
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
    </body></html>`;
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("popup-blocked");
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};

// ---------------------------------------------------------------------------
// EXCEL — SheetJS (.xlsx). Ana sayfa "Görevler" + "Alt Görevler" sayfası.
// ---------------------------------------------------------------------------
export const exportTasksExcel = (tasks, categoryNameById = {}, opts = {}) => {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  const rows = [];
  const subRows = [];
  for (const t of list) {
    const d = buildTaskData(t, categoryNameById);
    rows.push({
      "Başlık": d.title,
      "Açıklama": d.description,
      "Durum": d.status,
      "Son Tarih": d.due_date,
      "Tamamlanma Tarihi": d.completed_at,
      "Görev Sahibi": d.assignee,
      "Şirket": d.company,
      "İş Kolu": d.category,
      "Alt Görev Sayısı": d.subtasks.length,
    });
    for (const s of d.subtasks) {
      subRows.push({
        "Görev": d.title,
        "Alt Görev": s.text,
        "Durum": s.status,
        "Tarih": s.due_date,
      });
    }
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 40 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "Görevler");
  if (subRows.length) {
    const wss = XLSX.utils.json_to_sheet(subRows);
    wss["!cols"] = [{ wch: 28 }, { wch: 40 }, { wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wss, "Alt Görevler");
  }
  const base = list.length > 1 ? `Sertex-Gorevler-${stamp()}` : `Sertex-${sanitizeFilename(list[0]?.title)}`;
  XLSX.writeFile(wb, `${base}.xlsx`);
};

// ---------------------------------------------------------------------------
// WORD — docx (.docx)
// ---------------------------------------------------------------------------
const metaRow = (label, value) =>
  new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: "444444" })] })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: value || "—" })] })],
      }),
    ],
  });

const taskWordChildren = (d) => {
  const children = [
    new Paragraph({ text: d.title, heading: HeadingLevel.HEADING_2 }),
  ];
  if (d.description) {
    children.push(new Paragraph({ children: [new TextRun({ text: d.description, italics: true, color: "333333" })] }));
  }
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        metaRow("Durum", d.status),
        metaRow("Son Tarih", d.due_date),
        metaRow("Tamamlanma Tarihi", d.completed_at),
        metaRow("Görev Sahibi", d.assignee),
        metaRow("Şirket", d.company),
        metaRow("İş Kolu", d.category),
      ],
    })
  );
  if (d.subtasks.length) {
    children.push(
      new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Alt Görevler (${d.subtasks.length})`, bold: true })] })
    );
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: ["#", "Alt Görev", "Durum", "Tarih"].map(
              (h) =>
                new TableCell({
                  shading: { fill: "F2F7F9" },
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                })
            ),
          }),
          ...d.subtasks.map(
            (s, i) =>
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(String(i + 1))] }),
                  new TableCell({ children: [new Paragraph(s.text)] }),
                  new TableCell({ children: [new Paragraph(s.status)] }),
                  new TableCell({ children: [new Paragraph(s.due_date)] }),
                ],
              })
          ),
        ],
      })
    );
  }
  children.push(new Paragraph({ text: "", spacing: { after: 240 } }));
  return children;
};

export const exportTasksWord = async (tasks, categoryNameById = {}, opts = {}) => {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  const heading = opts.heading || (list.length > 1 ? `Görev Raporu (${list.length})` : "Görev Raporu");
  const children = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: "SERTEX", bold: true, size: 40, color: "0A7EA4" })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `${heading} · ${new Date().toLocaleString("tr-TR")}`, size: 18, color: "666666" })],
      spacing: { after: 240 },
    }),
  ];
  for (const t of list) {
    children.push(...taskWordChildren(buildTaskData(t, categoryNameById)));
  }
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const base = list.length > 1 ? `Sertex-Gorevler-${stamp()}` : `Sertex-${sanitizeFilename(list[0]?.title)}`;
  saveAs(blob, `${base}.docx`);
};
