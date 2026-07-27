import { create } from "zustand";
import type { JSONContent } from "@tiptap/core";
import {
  api,
  ResumeDocumentV1,
  ResumeRecord,
  ResumeStyleV1,
  ResumeSummary,
  ResumeVersion,
  User,
} from "../api/client";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
  editorDocumentToMarkdown,
  editorSettingsToStyle,
  resumeDocumentFromMarkdown,
  resumeDocumentToMarkdown,
  styleToEditorSettings,
} from "../api/resumeContract";
import { defaultResumeDocument } from "../features/workbench/defaultDocument";
import { defaultResumeMarkdown } from "../parser/defaultResume";
import { renderResumeMarkdown } from "../parser/resumeMarkdown";

export type ResumeTheme = "classic" | "modern" | "compact";

export type ResumeSettings = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  verticalPageMargin: number;
  theme: ResumeTheme;
  smartOnePage: boolean;
  showSource: boolean;
};

export const resumeSerifFontStack =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", STSong, SimSun, serif';

type AuthStatus = "checking" | "guest" | "authenticated";
type SaveStatus = "idle" | "saving" | "saved" | "error";

type ResumeState = {
  authStatus: AuthStatus;
  user: User | null;
  resumes: ResumeSummary[];
  versions: ResumeVersion[];
  versionsLoading: boolean;
  versionOperationPending: boolean;
  activeResumeId: string | null;
  lockVersion: number;
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
  title: string;
  markdown: string;
  editorContent: JSONContent | string;
  splitRatio: number;
  previewScale: number;
  settings: ResumeSettings;
  dirty: boolean;
  editVersion: number;
  saveStatus: SaveStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  listResumes: () => Promise<void>;
  createResume: (title?: string) => Promise<void>;
  importResume: (file: File, title?: string) => Promise<void>;
  loadResume: (id: string) => Promise<void>;
  deleteResume: (id: string) => Promise<void>;
  saveCurrentResume: () => Promise<void>;
  loadVersions: () => Promise<void>;
  createVersion: () => Promise<void>;
  deleteVersion: (versionNo: number) => Promise<void>;
  restoreVersion: (versionNo: number) => Promise<void>;
  goHome: () => void;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  setEditorContent: (content: JSONContent) => void;
  setSplitRatio: (ratio: number) => void;
  setPreviewScale: (scale: number) => void;
  updateSettings: (settings: Partial<ResumeSettings>) => void;
};

type SaveSnapshot = {
  activeResumeId: string;
  lockVersion: number;
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
  title: string;
  markdown: string;
  editorContent: JSONContent | string;
  settings: ResumeSettings;
  splitRatio: number;
  previewScale: number;
};

let saveQueue: Promise<void> = Promise.resolve();

export const defaultSettings: ResumeSettings = {
  fontFamily: resumeSerifFontStack,
  fontSize: 10.5,
  lineHeight: 1.32,
  pageMargin: 16,
  verticalPageMargin: 16,
  theme: "classic",
  smartOnePage: false,
  showSource: false,
};

function normalizeSettings(settings: Partial<ResumeSettings> = {}) {
  const normalized = { ...defaultSettings, ...settings, showSource: false };

  if (normalized.fontFamily.includes("Source Han Serif SC") && normalized.fontFamily.includes("SimSun")) {
    normalized.fontFamily = resumeSerifFontStack;
  }

  return normalized;
}

function applyResume(resume: ResumeRecord, localState?: ResumeState) {
  const markdown = resumeDocumentToMarkdown(resume.data);
  const semanticSettings = normalizeSettings(styleToEditorSettings(resume.style));
  return {
    activeResumeId: resume.id,
    lockVersion: resume.lock_version,
    data: resume.data,
    style: resume.style,
    title: resume.title,
    markdown,
    editorContent: renderResumeMarkdown(markdown),
    settings: semanticSettings,
    splitRatio: localState?.splitRatio ?? 0.4,
    previewScale: localState?.previewScale ?? 1,
    dirty: false,
    saveStatus: "saved" as SaveStatus,
    error: null,
  };
}

function settingsEqual(left: ResumeSettings, right: ResumeSettings) {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.pageMargin === right.pageMargin &&
    left.verticalPageMargin === right.verticalPageMargin &&
    left.theme === right.theme &&
    left.smartOnePage === right.smartOnePage &&
    left.showSource === right.showSource
  );
}

function matchesSaveSnapshot(state: ResumeState, snapshot: SaveSnapshot) {
  return (
    state.activeResumeId === snapshot.activeResumeId &&
    state.lockVersion === snapshot.lockVersion &&
    JSON.stringify(state.data) === JSON.stringify(snapshot.data) &&
    JSON.stringify(state.style) === JSON.stringify(snapshot.style) &&
    state.title === snapshot.title &&
    state.markdown === snapshot.markdown &&
    JSON.stringify(state.editorContent) === JSON.stringify(snapshot.editorContent) &&
    state.splitRatio === snapshot.splitRatio &&
    state.previewScale === snapshot.previewScale &&
    settingsEqual({ ...state.settings, showSource: false }, snapshot.settings)
  );
}

function summaryFromRecord(resume: ResumeRecord): ResumeSummary {
  return {
    id: resume.id,
    title: resume.title,
    source_type: resume.source_type,
    lock_version: resume.lock_version,
    created_at: resume.created_at,
    updated_at: resume.updated_at,
  };
}

function mergeResumeSummary(resumes: ResumeSummary[], resume: ResumeRecord) {
  const summary = summaryFromRecord(resume);
  const next = [summary, ...resumes.filter((item) => item.id !== resume.id)];
  return next.sort((left, right) => {
    const timeDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
    return timeDifference || Number(right.id) - Number(left.id);
  });
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  authStatus: "checking",
  user: null,
  resumes: [],
  versions: [],
  versionsLoading: false,
  versionOperationPending: false,
  activeResumeId: null,
  lockVersion: 0,
  data: defaultSemanticDocument,
  style: defaultSemanticStyle,
  title: "张三-后端开发实习生",
  markdown: defaultResumeMarkdown,
  editorContent: defaultResumeDocument,
  splitRatio: 0.4,
  previewScale: 1,
  settings: defaultSettings,
  dirty: false,
  editVersion: 0,
  saveStatus: "idle",
  error: null,

  hydrate: async () => {
    try {
      const { user } = await api.me();
      if (!user) {
        set({ authStatus: "guest", user: null, resumes: [], versions: [], activeResumeId: null, lockVersion: 0 });
        return;
      }

      set({ authStatus: "authenticated", user });
      await get().listResumes();
    } catch (error) {
      set({ authStatus: "guest", user: null, error: (error as Error).message });
    }
  },

  register: async (email, password) => {
    const { user } = await api.register(email, password);
    set({ authStatus: "authenticated", user, error: null });
    await get().createResume("我的第一份简历");
  },

  login: async (email, password) => {
    const { user } = await api.login(email, password);
    set({ authStatus: "authenticated", user, error: null });
    await get().listResumes();
  },

  logout: async () => {
    await api.logout();
    set({
      authStatus: "guest",
      user: null,
      resumes: [],
      versions: [],
      versionOperationPending: false,
      activeResumeId: null,
      lockVersion: 0,
      dirty: false,
      saveStatus: "idle",
    });
  },

  listResumes: async () => {
    const { resumes } = await api.listResumes();
    set({ resumes });
  },

  createResume: async (title = "未命名简历") => {
    const { resume } = await api.createResume({
      title,
    });
    const { resumes } = await api.listResumes();
    set({ resumes, versions: [], ...applyResume(resume) });
  },

  importResume: async (file, title) => {
    const { resume } = await api.importResume(file, title);
    set((state) => ({
      resumes: mergeResumeSummary(state.resumes, resume),
      versions: [],
      ...applyResume(resume),
    }));
  },

  loadResume: async (id) => {
    const { resume } = await api.getResume(id);
    set({ versions: [], ...applyResume(resume) });
  },

  deleteResume: async (id) => {
    const { deleted } = await api.deleteResume(id);
    if (!deleted) throw new Error("RESUME_DELETE_FAILED");
    set({ resumes: get().resumes.filter((resume) => resume.id !== id) });

    if (get().activeResumeId === id) {
      set({ activeResumeId: null, versions: [], lockVersion: 0, dirty: false, saveStatus: "idle" });
    }
  },

  saveCurrentResume: async () => {
    const requestedResumeId = get().activeResumeId;
    const queuedSave = saveQueue.then(async () => {
      const state = get();
      if (!state.activeResumeId || state.activeResumeId !== requestedResumeId || !state.dirty) return;
      const snapshot: SaveSnapshot = {
        activeResumeId: state.activeResumeId,
        lockVersion: state.lockVersion,
        data: state.data,
        style: state.style,
        title: state.title,
        markdown: state.markdown,
        editorContent: state.editorContent,
        settings: { ...state.settings, showSource: false },
        splitRatio: state.splitRatio,
        previewScale: state.previewScale,
      };

      set({ saveStatus: "saving", error: null });

      try {
        const dataChanged = snapshot.markdown !== resumeDocumentToMarkdown(snapshot.data);
        const { resume } = await api.updateResume(snapshot.activeResumeId, {
          title: snapshot.title,
          base_lock_version: snapshot.lockVersion,
          ...(dataChanged
            ? { data: resumeDocumentFromMarkdown(snapshot.markdown, snapshot.data) }
            : {}),
          style: editorSettingsToStyle(snapshot.settings, snapshot.style),
        });
        set((current) => {
          const resumes = mergeResumeSummary(current.resumes, resume);
          if (current.activeResumeId !== snapshot.activeResumeId) return { resumes };
          if (matchesSaveSnapshot(current, snapshot)) {
            return { resumes, ...applyResume(resume, current) };
          }

          return {
            resumes,
            lockVersion: resume.lock_version,
            data: resume.data,
            style: resume.style,
            dirty: true,
            saveStatus: "idle" as SaveStatus,
            error: null,
          };
        });
      } catch (error) {
        set({ saveStatus: "error", error: (error as Error).message });
      }
    });
    saveQueue = queuedSave.catch(() => undefined);
    await queuedSave;
  },

  loadVersions: async () => {
    const resumeId = get().activeResumeId;
    if (!resumeId) {
      set({ versions: [], versionsLoading: false });
      return;
    }
    set({ versionsLoading: true });
    try {
      const { versions } = await api.listVersions(resumeId);
      if (get().activeResumeId === resumeId) {
        set({ versions, versionsLoading: false, error: null });
      }
    } catch (error) {
      if (get().activeResumeId === resumeId) {
        set({ versionsLoading: false, error: (error as Error).message });
      }
      throw error;
    }
  },

  createVersion: async () => {
    const resumeId = get().activeResumeId;
    if (!resumeId) return;
    try {
      const { version } = await api.createVersion(resumeId);
      if (get().activeResumeId === resumeId) {
        set((state) => ({
          versions: [version, ...state.versions.filter((item) => item.id !== version.id)],
          error: null,
        }));
      }
      try {
        const { versions } = await api.listVersions(resumeId);
        if (get().activeResumeId === resumeId) set({ versions });
      } catch {
        // The version already exists; a failed refresh must not invite a duplicate retry.
      }
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  deleteVersion: async (versionNo) => {
    const resumeId = get().activeResumeId;
    if (!resumeId) return;
    set({ versionOperationPending: true, error: null });
    try {
      const { deleted } = await api.deleteVersion(resumeId, versionNo);
      if (!deleted) throw new Error("RESUME_VERSION_DELETE_FAILED");
      if (get().activeResumeId === resumeId) {
        set((state) => ({
          versions: state.versions.filter((version) => version.version_no !== versionNo),
          error: null,
        }));
      }
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    } finally {
      set({ versionOperationPending: false });
    }
  },

  restoreVersion: async (versionNo) => {
    const initialState = get();
    const resumeId = initialState.activeResumeId;
    if (!resumeId) return;
    set({ versionOperationPending: true, error: null });
    try {
      if (get().dirty) await get().saveCurrentResume();
      if (get().error) throw new Error(get().error ?? "RESUME_SAVE_FAILED");
      const localState = get();
      const { resume } = await api.restoreVersion(resumeId, versionNo);
      if (get().activeResumeId === resumeId) {
        set(applyResume(resume, localState));
      }
      try {
        const { versions } = await api.listVersions(resumeId);
        if (get().activeResumeId === resumeId) set({ versions });
      } catch {
        // Restore succeeded; retain the prior list until the next explicit refresh.
      }
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    } finally {
      set({ versionOperationPending: false });
    }
  },

  goHome: () => set({ activeResumeId: null, versions: [], lockVersion: 0 }),

  setTitle: (title) =>
    set((state) =>
      title === state.title
        ? {}
        : { title, dirty: true, editVersion: state.editVersion + 1, saveStatus: "idle" },
    ),
  setMarkdown: (markdown) =>
    set((state) =>
      markdown === state.markdown
        ? {}
        : { markdown, dirty: true, editVersion: state.editVersion + 1, saveStatus: "idle" },
    ),
  setEditorContent: (editorContent) =>
    set((state) => {
      if (JSON.stringify(editorContent) === JSON.stringify(state.editorContent)) return {};
      return {
        editorContent,
        markdown: editorDocumentToMarkdown(editorContent),
        dirty: true,
        editVersion: state.editVersion + 1,
        saveStatus: "idle",
      };
    }),
  setSplitRatio: (splitRatio) =>
    set((state) =>
      splitRatio === state.splitRatio
        ? {}
        : { splitRatio, dirty: true, editVersion: state.editVersion + 1, saveStatus: "idle" },
    ),
  setPreviewScale: (previewScale) =>
    set((state) =>
      previewScale === state.previewScale
        ? {}
        : { previewScale, dirty: true, editVersion: state.editVersion + 1, saveStatus: "idle" },
    ),
  updateSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings },
      dirty: true,
      editVersion: state.editVersion + 1,
      saveStatus: "idle",
    })),
}));
