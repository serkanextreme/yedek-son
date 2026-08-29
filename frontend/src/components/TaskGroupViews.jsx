import { useState } from "react";
import { createPortal } from "react-dom";
import { Reorder, useDragControls } from "framer-motion";
import { Rnd } from "react-rnd";
import { Edit3, GripVertical, Maximize2, Minimize2, ArrowLeft, Link2, Unlink } from "lucide-react";
import { TaskCard } from "./TaskCard";
import { ResizeGrip } from "./ResizeGrip";

export const ReorderableTaskCard = ({ task, onDragToCategory, onDropToCategory, ...rest }) => {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={task}
      dragListener={false}
      dragControls={controls}
      onDrag={onDragToCategory}
      onDragEnd={(e, info) => onDropToCategory && onDropToCategory(e, info)}
      layout
    >
      <TaskCard task={task} {...rest} dragControls={controls} />
    </Reorder.Item>
  );
};

// Task 4 — dışarı alınan görevin listedeki yerinde görünen kompakt yer tutucu.
export const DetachedPlaceholderCard = ({ task, displayNumber, onDock }) => (
  <div
    data-testid={`task-detached-placeholder-${task.id}`}
    className="rounded-lg border border-dashed border-sertex-cyan/40 bg-sertex-cyan/5 p-2.5 flex items-center gap-2"
  >
    <Maximize2 className="h-4 w-4 text-sertex-cyan shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="hud-text text-sertex-cyan/90 truncate">
        {displayNumber ? `#${displayNumber} ` : ""}{task.title}
      </div>
      <div className="text-[10px] font-mono text-sertex-textMuted">Bu görev büyük pencerede açık</div>
    </div>
    <button
      onClick={onDock}
      data-testid={`task-redock-${task.id}`}
      title="Sidebar'a geri al"
      className="shrink-0 px-2 py-1 rounded-md border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/15 hud-text flex items-center gap-1 transition-colors"
    >
      <Minimize2 className="h-3.5 w-3.5" /> GERİ AL
    </button>
  </div>
);

// Reorder.Group içinde yer tutucuyu (detached kart) sürüklemeden tutmak için.
export const ReorderablePlaceholder = ({ task, ...rest }) => (
  <Reorder.Item value={task} dragListener={false} layout>
    <DetachedPlaceholderCard task={task} {...rest} />
  </Reorder.Item>
);

// GÖREV BAĞLAMA — Dış listede tek bir görevi temsil eden satır (value = key).
export const OuterTaskRow = ({ rowKey, cardProps, detached, placeholderProps }) => {
  const controls = useDragControls();
  const { onDragToCategory, onDropToCategory, ...restCard } = cardProps || {};
  return (
    <Reorder.Item
      value={rowKey}
      dragListener={false}
      dragControls={detached ? undefined : controls}
      onDrag={detached ? undefined : onDragToCategory}
      onDragEnd={detached ? undefined : (e, info) => onDropToCategory && onDropToCategory(e, info)}
      layout
    >
      {detached ? (
        <DetachedPlaceholderCard {...placeholderProps} />
      ) : (
        <TaskCard {...restCard} dragControls={controls} />
      )}
    </Reorder.Item>
  );
};

// GÖREV BAĞLAMA — dışarı alınan grup penceresinde tek üye satırı (sürükle-sırala).
export const GroupWindowMemberRow = ({ task, cardProps }) => {
  const controls = useDragControls();
  return (
    <Reorder.Item value={task} dragListener={false} dragControls={controls} layout>
      <div className="flex items-start gap-1.5">
        <button
          onPointerDown={(e) => controls.start(e)}
          title="Sırala"
          data-testid={`group-window-drag-${task.id}`}
          className="cursor-grab touch-none p-1 mt-2 text-sertex-cyan/50 hover:text-sertex-cyan shrink-0"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <TaskCard {...cardProps} detached />
        </div>
      </div>
    </Reorder.Item>
  );
};

// GÖREV BAĞLAMA — Personel Görevleri (team) için statik grup bloğu (sürükleme yok).
export const StaticTaskGroupBlock = ({ group, tasks, renderStaticMember, onEditGroup, onDissolve }) => {
  const doneCount = tasks.filter((t) => t.status === "done").length;
  return (
    <div
      className="rounded-xl border-2 border-sertex-cyan/40 bg-sertex-cyan/[0.04] p-1.5 space-y-1.5 shadow-[0_0_18px_rgba(34,211,238,0.08)]"
      data-testid={`task-group-${group.id}`}
    >
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <Link2 className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
        <span className="hud-text text-sertex-cyan flex-1 truncate tracking-wider">
          {group.name || "BAĞLI GÖREVLER"}
        </span>
        {group.show_progress && (
          <span
            className="hud-text px-1.5 py-0.5 rounded border border-sertex-cyan/40 text-sertex-cyan bg-sertex-cyan/10 whitespace-nowrap"
            data-testid={`group-progress-${group.id}`}
          >
            {doneCount}/{tasks.length} tamamlandı
          </span>
        )}
        <button
          onClick={() => onEditGroup(group)}
          title="Grubu düzenle"
          data-testid={`group-edit-${group.id}`}
          className="p-1 text-sertex-textMuted hover:text-sertex-cyan transition-colors"
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDissolve(group)}
          title="Bağlantıyı çöz"
          data-testid={`group-dissolve-${group.id}`}
          className="p-1 text-rose-300/80 hover:text-rose-300 transition-colors"
        >
          <Unlink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2">{tasks.map((t) => renderStaticMember(t))}</div>
    </div>
  );
};


// GÖREV BAĞLAMA — Bağlı görevleri tek blok halinde gösteren grup kutusu.
// Blok başlığındaki tutamaçtan sürüklenince tüm üyeler birlikte taşınır;
// içteki Reorder.Group ile grup içi sıra da sürüklenerek değiştirilebilir.
export const TaskGroupBlock = ({ rowKey, group, tasks, renderMember, onReorderGroup, onEditGroup, onDissolve, onDetach }) => {
  const controls = useDragControls();
  const doneCount = tasks.filter((t) => t.status === "done").length;
  return (
    <Reorder.Item value={rowKey} dragListener={false} dragControls={controls} layout>
      <div
        className="rounded-xl border-2 border-sertex-cyan/40 bg-sertex-cyan/[0.04] p-1.5 space-y-1.5 shadow-[0_0_18px_rgba(34,211,238,0.08)]"
        data-testid={`task-group-${group.id}`}
      >
        <div className="flex items-center gap-1.5 px-1 py-0.5">
          <button
            onPointerDown={(e) => controls.start(e)}
            title="Grubu taşı (hepsi birlikte)"
            data-testid={`group-drag-${group.id}`}
            className="cursor-grab touch-none p-1 text-sertex-cyan/70 hover:text-sertex-cyan"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Link2 className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
          <span className="hud-text text-sertex-cyan flex-1 truncate tracking-wider">
            {group.name || "BAĞLI GÖREVLER"}
          </span>
          {group.show_progress && (
            <span
              className="hud-text px-1.5 py-0.5 rounded border border-sertex-cyan/40 text-sertex-cyan bg-sertex-cyan/10 whitespace-nowrap"
              data-testid={`group-progress-${group.id}`}
            >
              {doneCount}/{tasks.length} tamamlandı
            </span>
          )}
          <button
            onClick={() => onEditGroup(group)}
            title="Grubu düzenle"
            data-testid={`group-edit-${group.id}`}
            className="p-1 text-sertex-textMuted hover:text-sertex-cyan transition-colors"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDetach(group)}
            title="Grubu dışarı al (büyük pencere)"
            data-testid={`group-detach-${group.id}`}
            className="p-1 text-sertex-textMuted hover:text-sertex-cyan transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDissolve(group)}
            title="Bağlantıyı çöz"
            data-testid={`group-dissolve-${group.id}`}
            className="p-1 text-rose-300/80 hover:text-rose-300 transition-colors"
          >
            <Unlink className="h-3.5 w-3.5" />
          </button>
        </div>
        <Reorder.Group
          axis="y"
          values={tasks}
          onReorder={(nt) => onReorderGroup(group.id, nt)}
          className="space-y-2"
        >
          {tasks.map((t) => renderMember(t))}
        </Reorder.Group>
      </div>
    </Reorder.Item>
  );
};


// Task 4 (Görev Karşılaştırma Masası) — detach pencere konum/boyut + hangi
// görevlerin dışarı alındığı localStorage'da kalıcıdır (reload'da geri gelir).
const DETACHED_GEOM_KEY = "sertex_detached_task_geom_v1";
const loadDetachedGeom = () => {
  try { return JSON.parse(localStorage.getItem(DETACHED_GEOM_KEY) || "{}"); } catch { return {}; }
};
const saveDetachedGeom = (id, patch) => {
  try {
    const all = loadDetachedGeom();
    all[id] = { ...(all[id] || {}), ...patch };
    localStorage.setItem(DETACHED_GEOM_KEY, JSON.stringify(all));
  } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
};

// Task 4 — görevi sidebar dışında büyük, sürüklenebilir + boyutlandırılabilir
// yüzen pencerede açar (createPortal ile document.body'ye çizilir).
export const DetachedTaskWindow = ({ task, index = 0, onDock, children }) => {
  const DEF_W = Math.min(640, window.innerWidth - 80);
  const DEF_H = Math.min(680, window.innerHeight - 100);
  const saved = loadDetachedGeom()[task.id] || {};
  const clampX = (x) => Math.max(0, Math.min(window.innerWidth - 160, x));
  const clampY = (y) => Math.max(0, Math.min(window.innerHeight - 80, y));
  const [pos, setPos] = useState({
    x: clampX(saved.x ?? Math.round(window.innerWidth / 2 - DEF_W / 2) + index * 34),
    y: clampY(saved.y ?? Math.round(window.innerHeight / 2 - DEF_H / 2) + index * 34),
  });
  const [size, setSize] = useState({
    width: saved.width ?? DEF_W,
    height: saved.height ?? DEF_H,
  });
  return createPortal(
    <Rnd
      position={pos}
      size={size}
      minWidth={320}
      minHeight={240}
      bounds="window"
      dragHandleClassName={`detached-task-header-${task.id}`}
      onDragStop={(e, d) => { setPos({ x: d.x, y: d.y }); saveDetachedGeom(task.id, { x: d.x, y: d.y }); }}
      onResizeStop={(e, dir, ref, delta, p) => {
        const w = parseInt(ref.style.width, 10) || DEF_W;
        const h = parseInt(ref.style.height, 10) || DEF_H;
        setSize({ width: w, height: h });
        setPos(p);
        saveDetachedGeom(task.id, { x: p.x, y: p.y, width: w, height: h });
      }}
      style={{ zIndex: 60 }}
      resizeHandleComponent={{ bottomRight: <ResizeGrip testId={`task-${task.id}`} /> }}
      data-testid={`detached-task-window-${task.id}`}
    >
      <div className="h-full flex flex-col glass-panel rounded-lg overflow-hidden border border-sertex-cyan/50 shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
        <div
          className={`detached-task-header-${task.id} flex items-center gap-2 px-3 py-2 border-b border-sertex-cyan/30 bg-sertex-cyan/10 cursor-move select-none`}
        >
          <Maximize2 className="h-4 w-4 text-sertex-cyan shrink-0" />
          <div className="flex-1 min-w-0 hud-text text-sertex-cyan truncate">
            GÖREV · {task.title}
          </div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDock(); }}
            data-testid={`detached-task-dock-${task.id}`}
            title="Sidebar'a geri al"
            className="shrink-0 px-2 py-1 rounded-md border border-sertex-cyan/50 text-sertex-cyan hover:bg-sertex-cyan/20 hud-text flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> SIDEBAR'A GERİ AL
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-sertex p-3">
          {children}
        </div>
      </div>
    </Rnd>,
    document.body
  );
};

// GÖREV BAĞLAMA — dışarı alınan bağlı grup için localStorage anahtarı.
export const DetachedGroupWindow = ({ group, doneCount = 0, total = 0, index = 0, onDock, children }) => {
  const DEF_W = Math.min(680, window.innerWidth - 80);
  const DEF_H = Math.min(720, window.innerHeight - 100);
  const geomKey = `group:${group.id}`;
  const saved = loadDetachedGeom()[geomKey] || {};
  const clampX = (x) => Math.max(0, Math.min(window.innerWidth - 160, x));
  const clampY = (y) => Math.max(0, Math.min(window.innerHeight - 80, y));
  const [pos, setPos] = useState({
    x: clampX(saved.x ?? Math.round(window.innerWidth / 2 - DEF_W / 2) + index * 34),
    y: clampY(saved.y ?? Math.round(window.innerHeight / 2 - DEF_H / 2) + index * 34),
  });
  const [size, setSize] = useState({
    width: saved.width ?? DEF_W,
    height: saved.height ?? DEF_H,
  });
  return createPortal(
    <Rnd
      position={pos}
      size={size}
      minWidth={340}
      minHeight={260}
      bounds="window"
      dragHandleClassName={`detached-group-header-${group.id}`}
      onDragStop={(e, d) => { setPos({ x: d.x, y: d.y }); saveDetachedGeom(geomKey, { x: d.x, y: d.y }); }}
      onResizeStop={(e, dir, ref, delta, p) => {
        const w = parseInt(ref.style.width, 10) || DEF_W;
        const h = parseInt(ref.style.height, 10) || DEF_H;
        setSize({ width: w, height: h });
        setPos(p);
        saveDetachedGeom(geomKey, { x: p.x, y: p.y, width: w, height: h });
      }}
      style={{ zIndex: 60 }}
      resizeHandleComponent={{ bottomRight: <ResizeGrip testId={`group-${group.id}`} /> }}
      data-testid={`detached-group-window-${group.id}`}
    >
      <div className="h-full flex flex-col glass-panel rounded-lg overflow-hidden border-2 border-sertex-cyan/50 shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
        <div
          className={`detached-group-header-${group.id} flex items-center gap-2 px-3 py-2 border-b border-sertex-cyan/30 bg-sertex-cyan/10 cursor-move select-none`}
        >
          <Link2 className="h-4 w-4 text-sertex-cyan shrink-0" />
          <div className="flex-1 min-w-0 hud-text text-sertex-cyan truncate">
            {group.name || "BAĞLI GÖREVLER"}
          </div>
          {group.show_progress && (
            <span className="hud-text px-1.5 py-0.5 rounded border border-sertex-cyan/40 text-sertex-cyan bg-sertex-cyan/10 whitespace-nowrap shrink-0">
              {doneCount}/{total} tamamlandı
            </span>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDock(); }}
            data-testid={`detached-group-dock-${group.id}`}
            title="Sidebar'a geri al"
            className="shrink-0 px-2 py-1 rounded-md border border-sertex-cyan/50 text-sertex-cyan hover:bg-sertex-cyan/20 hud-text flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> SIDEBAR'A GERİ AL
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-sertex p-3 space-y-2">
          {children}
        </div>
      </div>
    </Rnd>,
    document.body
  );
};

// GÖREV BAĞLAMA — grup dışarı alındığında sidebar'da kalan yer tutucu.
export const GroupDetachedRow = ({ rowKey, group, count, onDock }) => (
  <Reorder.Item value={rowKey} dragListener={false} layout>
    <div
      className="rounded-xl border-2 border-dashed border-sertex-cyan/40 bg-sertex-cyan/5 p-2.5 flex items-center gap-2"
      data-testid={`task-group-detached-${group.id}`}
    >
      <Maximize2 className="h-4 w-4 text-sertex-cyan shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="hud-text text-sertex-cyan/90 truncate flex items-center gap-1">
          <Link2 className="h-3 w-3 shrink-0" /> {group.name || "BAĞLI GÖREVLER"} ({count})
        </div>
        <div className="text-[10px] font-mono text-sertex-textMuted">Bu grup büyük pencerede açık</div>
      </div>
      <button
        onClick={onDock}
        data-testid={`group-redock-${group.id}`}
        title="Sidebar'a geri al"
        className="shrink-0 px-2 py-1 rounded-md border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/15 hud-text flex items-center gap-1 transition-colors"
      >
        <Minimize2 className="h-3.5 w-3.5" /> GERİ AL
      </button>
    </div>
  </Reorder.Item>
);

