import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { t } from "../../lib/i18n";
import TasksPanel from "../TasksPanel";
import MemoryPanel from "../MemoryPanel";
import FilePanel from "../FilePanel";
import BackupPanel from "../BackupPanel";
import EmailPanel from "../EmailPanel";
import TeamPanel from "../TeamPanel";
import OrphanTasksPanel from "../OrphanTasksPanel";

/**
 * Renders the body for a single sidebar tab. Reused between the sidebar's
 * own content area and any detached FloatingTabWindow so that the two views
 * stay 100% behaviourally identical.
 *
 * Data-heavy tabs (tasks/memory/files/email/backup) delegate to their own
 * top-level panels. History and Notes are inlined because they are tiny and
 * depend on Sidebar-owned state (conversations list, notes list, input).
 */
const SidebarTabContent = ({
  tabKey,
  lang,
  refreshKey,
  isAdmin,
  onDataChanged,
  // history tab
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  // notes tab
  notes,
  noteInput,
  setNoteInput,
  onAddNote,
  onDeleteNote,
}) => {
  if (tabKey === "history") {
    return (
      <>
        <button
          onClick={onNewChat}
          className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
          data-testid="new-chat-button"
        >
          <Plus className="h-3.5 w-3.5" /> {t(lang, "newChat")}
        </button>
        {conversations.length === 0 ? (
          <div className="hud-text text-sertex-textMuted text-center py-6">
            {t(lang, "empty")}
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelectConversation(c.id)}
              data-testid={`conv-item-${c.id}`}
              className={`p-2 border cursor-pointer transition-colors rounded-md group ${
                activeConversationId === c.id
                  ? "border-sertex-cyan bg-sertex-cyan/10"
                  : "border-sertex-cyan/15 hover:border-sertex-cyan/40 hover:bg-sertex-cyan/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-sertex-text truncate font-mono">
                    {c.title}
                  </div>
                  <div className="hud-text text-sertex-textMuted mt-0.5">
                    {new Date(c.updated_at).toLocaleString(
                      lang === "tr" ? "tr-TR" : "en-US",
                      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-sertex-textMuted hover:text-sertex-danger transition-opacity"
                  data-testid={`conv-delete-${c.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </>
    );
  }
  if (tabKey === "tasks") return <TasksPanel refreshSignal={refreshKey} onDataChanged={onDataChanged} />;
  if (tabKey === "team") return <TeamPanel refreshSignal={refreshKey} onDataChanged={onDataChanged} />;
  if (tabKey === "orphans") return <OrphanTasksPanel refreshSignal={refreshKey} onDataChanged={onDataChanged} />;
  if (tabKey === "memory") return <MemoryPanel refreshSignal={refreshKey} onDataChanged={onDataChanged} />;
  if (tabKey === "files") return <FilePanel refreshSignal={refreshKey} onDataChanged={onDataChanged} />;
  if (tabKey === "email") return <EmailPanel onDataChanged={onDataChanged} />;
  if (tabKey === "backup") return isAdmin ? <BackupPanel /> : null;
  if (tabKey === "notes") {
    return (
      <>
        <div className="flex gap-2">
          <input
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddNote()}
            placeholder={t(lang, "addNote")}
            data-testid="note-input"
            className="flex-1 bg-sertex-surface border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none transition-colors"
          />
          <button
            onClick={onAddNote}
            data-testid="note-add"
            className="px-3 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {notes.length === 0 ? (
          <div className="hud-text text-sertex-textMuted text-center py-6">
            {t(lang, "empty")}
          </div>
        ) : (
          notes.map((n) => (
            <div
              key={n.id}
              data-testid={`note-item-${n.id}`}
              className="p-2 border border-sertex-cyan/15 rounded-md group hover:border-sertex-cyan/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-sertex-text font-mono flex-1">
                  {n.content}
                </div>
                <button
                  onClick={() => onDeleteNote(n.id)}
                  className="opacity-0 group-hover:opacity-100 text-sertex-textMuted hover:text-sertex-danger"
                  data-testid={`note-delete-${n.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="hud-text text-sertex-textMuted mt-1">
                {new Date(n.created_at).toLocaleString(
                  lang === "tr" ? "tr-TR" : "en-US",
                  { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
                )}
              </div>
            </div>
          ))
        )}
      </>
    );
  }
  return null;
};

export default SidebarTabContent;
