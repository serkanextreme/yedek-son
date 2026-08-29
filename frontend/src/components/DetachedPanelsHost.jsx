import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { ArrowLeft, ListTodo, Tag } from "lucide-react";
import TasksPanel from "./TasksPanel";
import { ResizeGrip } from "./ResizeGrip";
import {
  getDetachedPanels,
  subscribeDetachedPanels,
  closeDetachedPanel,
} from "../lib/detachedPanels";

const GEOM_KEY = "sertex_detached_panel_geom_v1";
const loadGeom = (id) => {
  try {
    return (JSON.parse(localStorage.getItem(GEOM_KEY) || "{}"))[id] || null;
  } catch {
    return null;
  }
};
const saveGeom = (id, g) => {
  try {
    const all = JSON.parse(localStorage.getItem(GEOM_KEY) || "{}");
    all[id] = g;
    localStorage.setItem(GEOM_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("[DetachedPanelsHost] geom save failed:", e);
  }
};

const PanelWindow = ({ panel, index, onData }) => {
  const g =
    loadGeom(panel.id) || {
      x: 140 + index * 40,
      y: 90 + index * 40,
      width: 460,
      height: 620,
    };
  return createPortal(
    <Rnd
      default={g}
      minWidth={340}
      minHeight={300}
      bounds="window"
      dragHandleClassName="dp-drag"
      onDragStop={(e, d) =>
        saveGeom(panel.id, {
          x: d.x,
          y: d.y,
          width: loadGeom(panel.id)?.width || g.width,
          height: loadGeom(panel.id)?.height || g.height,
        })
      }
      onResizeStop={(e, dir, ref, delta, pos) =>
        saveGeom(panel.id, {
          x: pos.x,
          y: pos.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        })
      }
      style={{ zIndex: 60 + index }}
      resizeHandleComponent={{ bottomRight: <ResizeGrip testId={`panel-${panel.id}`} /> }}
      data-testid={`detached-panel-window-${panel.id}`}
    >
      {/* overflow-hidden iç sarmalayıcıda — Rnd kökünde OLMAMALI, yoksa
          react-rnd'nin kutu dışına taşan resize tutamaçları kırpılır ve
          boyutlandırma çalışmaz (DetachedTaskWindow ile aynı yapı). */}
      <div className="h-full flex flex-col glass-panel corner-bracket border border-sertex-cyan/40 shadow-2xl overflow-hidden bg-sertex-bg/95 rounded-lg">
        <div className="dp-drag cursor-move flex items-center justify-between px-3 py-2 border-b border-sertex-cyan/30 bg-sertex-surface/70 shrink-0">
          <div className="hud-text text-sertex-cyan flex items-center gap-1.5 truncate">
            {panel.category ? (
              <Tag className="h-3 w-3 shrink-0" />
            ) : (
              <ListTodo className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{panel.categoryName || "GÖREVLER"}</span>
          </div>
          <button
            onClick={() => closeDetachedPanel(panel.id)}
            data-testid={`detached-panel-dock-${panel.id}`}
            title="Sidebar'a geri al"
            className="p-1 rounded border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/15 transition-colors shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-sertex p-3">
          <TasksPanel
            detached
            initialCategory={panel.category}
            onDataChanged={onData}
            onDock={() => closeDetachedPanel(panel.id)}
          />
        </div>
      </div>
    </Rnd>,
    document.body,
  );
};

export const DetachedPanelsHost = ({ onDataChanged }) => {
  const [panels, setPanels] = useState(getDetachedPanels());
  useEffect(() => subscribeDetachedPanels(setPanels), []);
  if (!panels.length) return null;
  return (
    <>
      {panels.map((p, i) => (
        <PanelWindow key={p.id} panel={p} index={i} onData={onDataChanged} />
      ))}
    </>
  );
};

export default DetachedPanelsHost;
