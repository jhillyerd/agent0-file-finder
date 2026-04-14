import { createStore } from "/js/AlpineStore.js";
import { callJsonApi } from "/js/api.js";
import { getCurrentContextId } from "/js/shortcuts.js";

const STORE_KEY = "fileFinder";
const POPUP_ID = "file-finder-popup";

const model = {
  // --- State ---
  visible: false,
  files: [],
  filtered: [],
  query: "",
  selectedIndex: 0,
  triggerStart: -1,
  loading: false,
  basePath: "",
  _attached: false,

  // Popup position (fixed) — bottom edge aligns with top of textarea
  popupBottom: 0,
  popupLeft: 0,
  popupWidth: 0,

  // --- Lifecycle ---
  init() {
    this._attachKeyListener();
  },

  onOpen() {
    this._attachKeyListener();
  },

  cleanup() {
    this.close();
  },

  _attachKeyListener() {
    if (this._attached) return;

    const tryAttach = () => {
      const ta = document.getElementById("chat-input");
      if (!ta) return false;

      // Use capture phase so we can intercept Enter BEFORE Alpine's handler
      ta.addEventListener("keydown", (e) => this._onKeyDown(e), { capture: true });
      ta.addEventListener("input", () => this._onInput());
      this._attached = true;
      return true;
    };

    if (!tryAttach()) {
      const observer = new MutationObserver(() => {
        if (tryAttach()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  },

  // --- Positioning ---
  _updatePosition() {
    const ta = document.getElementById("chat-input");
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    this.popupLeft = rect.left;
    this.popupWidth = rect.width;
    // Bottom of popup = top of textarea - gap
    this.popupBottom = window.innerHeight - rect.top + 4;
  },

  // --- Key handling ---
  _onKeyDown(e) {
    if (this.visible) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
        this._scrollToSelected();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this._scrollToSelected();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._selectCurrent();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
    }

    // Trigger on @ key
    if (e.key === "@" && !this.visible) {
      this.triggerStart = e.target.selectionStart + 1;
      this.query = "";
      this._openPopup();
    }
  },

  _onInput() {
    if (!this.visible || this.triggerStart < 0) return;

    const ta = document.getElementById("chat-input");
    if (!ta) return;

    const val = ta.value;
    // Close if user moved cursor before trigger or deleted the @
    if (this.triggerStart > ta.selectionStart || val[this.triggerStart - 1] !== "@") {
      this.close();
      return;
    }

    const afterTrigger = val.substring(this.triggerStart, ta.selectionStart);
    // Close on space (user finished typing reference)
    if (afterTrigger.includes(" ")) {
      this.close();
      return;
    }

    this.query = afterTrigger;
    this._applyFilter();
  },

  // --- Popup ---
  async _openPopup() {
    this.visible = true;
    this.selectedIndex = 0;
    this.filtered = [];
    this.loading = true;
    this._updatePosition();

    try {
      const ctxid = getCurrentContextId() || "";
      const resp = await callJsonApi(
        "/plugins/files_plugin/file_search",
        { ctxid, query: "" }
      );
      if (resp.ok) {
        this.files = resp.files || [];
        this.basePath = resp.base_path || "";
      } else {
        this.files = [];
      }
    } catch (err) {
      console.error("File finder error:", err);
      this.files = [];
    }

    this.loading = false;
    this._applyFilter();
  },

  _applyFilter() {
    const q = this.query.toLowerCase().trim();
    if (!q) {
      this.filtered = this.files.slice(0, 50);
    } else {
      this.filtered = this.files
        .filter((f) => _fuzzyMatch(f.path.toLowerCase(), q))
        .sort((a, b) => _fuzzyScore(b.path.toLowerCase(), q) - _fuzzyScore(a.path.toLowerCase(), q))
        .slice(0, 50);
    }
    this.selectedIndex = 0;
  },

  _selectCurrent() {
    const item = this.filtered[this.selectedIndex];
    if (!item) {
      this.close();
      return;
    }

    const ta = document.getElementById("chat-input");
    if (!ta) { this.close(); return; }

    const val = ta.value;
    const insert = "`" + item.path + "`";
    const before = val.substring(0, this.triggerStart - 1);
    const after = val.substring(this.triggerStart + this.query.length);
    const newVal = before + insert + " " + after;

    // Update Alpine store
    const chatInputStore = window.Alpine?.store("chatInput");
    if (chatInputStore) {
      chatInputStore.message = newVal;
    } else {
      ta.value = newVal;
    }

    // Position cursor after inserted text
    const cursorPos = before.length + insert.length + 1;
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = cursorPos;
      ta.focus();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    this.close();
  },

  selectItem(index) {
    this.selectedIndex = index;
    this._selectCurrent();
  },

  _scrollToSelected() {
    requestAnimationFrame(() => {
      const popup = document.getElementById(POPUP_ID);
      if (!popup) return;
      const items = popup.querySelectorAll(".ff-item");
      const el = items[this.selectedIndex];
      if (el) el.scrollIntoView({ block: "nearest" });
    });
  },

  close() {
    this.visible = false;
    this.files = [];
    this.filtered = [];
    this.query = "";
    this.triggerStart = -1;
    this.selectedIndex = 0;
    this.loading = false;
  },
};

// --- Fuzzy matching helpers ---

function _fuzzyMatch(text, query) {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    ti = text.indexOf(ch, ti);
    if (ti < 0) return false;
    ti++;
  }
  return true;
}

function _fuzzyScore(text, query) {
  let score = 0;
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    const idx = text.indexOf(ch, ti);
    if (idx < 0) return -1;
    if (idx === ti) score += 10;
    if (idx > 0 && "/._-".includes(text[idx - 1])) score += 5;
    const lastSlash = text.lastIndexOf("/");
    if (lastSlash >= 0 && idx > lastSlash) score += 3;
    score += 1;
    ti = idx + 1;
  }
  return score;
}

export const store = createStore(STORE_KEY, model);
