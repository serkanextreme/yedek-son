// Test IDs for the tasks list + profile screens. See ./auth.js for the recipe.

export const TASKS = {
  screen: 'tasks-screen',
  searchInput: 'tasks-search-input',
  expandAll: 'tasks-expand-all-button',
  collapseAll: 'tasks-collapse-all-button',
  errorRetry: 'tasks-error-retry-button',
  emptyState: 'tasks-empty-state',
  categoryHeader: 'tasks-category-header',
  uncategorizedHeader: 'tasks-uncategorized-header',
  taskRow: 'task-row',
  taskToggle: 'task-toggle',
  taskStart: 'task-row-start',
  taskDue: 'task-row-due',
  taskCompleted: 'task-row-completed',
  taskDuration: 'task-row-duration',
  taskReminder: 'task-row-reminder',
  taskAssignees: 'task-row-assignees',
  taskGroupBadge: 'task-row-group-badge',
  linkOpen: 'tasks-link-open-button',
  hideEmpty: 'tasks-hide-empty-toggle',
  companyFilter: 'tasks-company-filter',
  companySearch: 'tasks-company-search',
  // Görev Kopyalama (Kopyala → Yapıştır)
  categoryPaste: 'tasks-category-paste',
  clipboardBar: 'tasks-clipboard-bar',
  clipboardClear: 'tasks-clipboard-clear',
};

// Görev Bağlama modalı (LinkTasksModal) — tasks ekranı + detay grup düzenleme.
export const LINK = {
  modal: 'link-tasks-modal',
  name: 'link-group-name',
  showProgress: 'link-show-progress',
  selected: 'link-selected',
  moveUp: 'link-move-up',
  moveDown: 'link-move-down',
  remove: 'link-remove',
  add: 'link-add',
  save: 'link-save',
  cancel: 'link-cancel',
  close: 'link-close',
};

export const PROFILE = {
  screen: 'profile-screen',
  username: 'profile-username',
  role: 'profile-role',
};

export const TASK_FORM = {
  fab: 'task-create-fab',
  modal: 'task-form-modal',
  titleInput: 'task-form-title-input',
  descInput: 'task-form-desc-input',
  saveButton: 'task-form-save-button',
  cancelButton: 'task-form-cancel-button',
  deleteButton: 'task-form-delete-button',
  categoryChip: 'task-form-category-chip',
  dueChip: 'task-form-due-chip',
  startChip: 'task-form-start-chip',
  assigneeSearch: 'task-form-assignee-search-input',
  assigneeResult: 'task-form-assignee-result',
  assigneeChip: 'task-form-assignee-chip',
  deleteConfirm: 'task-form-delete-confirm',
  deleteCancel: 'task-form-delete-cancel',
  startCustom: 'task-form-start-custom',
  dueCustom: 'task-form-due-custom',
  pickerSheet: 'task-form-picker-sheet',
  pickerConfirm: 'task-form-picker-confirm',
  pickerCancel: 'task-form-picker-cancel',
};
