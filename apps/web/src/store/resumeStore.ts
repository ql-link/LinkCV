import { create } from "zustand";
import type { JSONContent } from "@tiptap/core";
import {
  api,
  ImportWarning,
  ResumeRecord,
  ResumeImportSummary,
  ResumeSummary,
  ResumeVersion,
  User,
  UserProfile,
} from "../api/client";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  editorDocumentToMarkdown,
  editorSettingsToStyle,
  resumeDocumentToMarkdown,
  resumePresentationTemplateDefinition,
  styleToEditorSettings,
  withResumePresentationAvatarSize,
} from "../api/resumeContract";
import { defaultResumeDocument } from "../features/workbench/defaultDocument";
import {
  composeEditorDocumentForTemplate,
  composeEditorDocumentForLayoutPlan,
  composeResumeMarkdownForTemplate,
  stripTemplateProjectionFromEditorDocument,
} from "../features/workbench/templateLayout";
import {
  editorDocumentUserAvatar,
  resumeDocumentFromEditorDocument,
  resumeDocumentToEditorDocument,
} from "../features/workbench/resumeEditorPersistence";
import { defaultResumeMarkdown } from "../parser/defaultResume";
import { renderResumeMarkdown } from "../parser/resumeMarkdown";
import { buildNamedImportFile } from "../lib/resumeImport";

export type ResumeTheme =
  | "classic"
  | "modern"
  | "compact"
  | "classic-technical"
  | "administrative-sidebar"
  | "campus-professional"
  | "civic-service"
  | "creative-orange";

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
  '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif';

type AuthStatus = "checking" | "guest" | "authenticated";
type SaveStatus = "idle" | "saving" | "saved" | "error";

let templateOperationSequence = 0;

type ResumeState = {
  authStatus: AuthStatus;
  user: User | null;
  resumes: ResumeSummary[];
  activeImports: ResumeImportSummary[];
  failedImports: ResumeImportSummary[];
  versions: ResumeVersion[];
  versionsLoading: boolean;
  versionOperationPending: boolean;
  importWarningsByResumeId: Record<string, ImportWarning[]>;
  activeResumeId: string | null;
  lockVersion: number;
  data: import("../api/resumeContract").CanonicalResumeDocument;
  style: import("../api/resumeContract").CanonicalResumePresentation;
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
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithWechat: (user: User) => Promise<void>;
  logout: () => Promise<void>;
  syncProfile: (user: UserProfile) => void;
  listResumes: () => Promise<void>;
  createResume: (title: string, templateId: string) => Promise<string>;
  importResume: (file: File, templateId: string, title?: string) => Promise<string>;
  pollResumeImport: (id: string) => Promise<void>;
  loadResume: (id: string) => Promise<void>;
  renameResume: (id: string, title: string) => Promise<void>;
  deleteResume: (id: string) => Promise<void>;
  deleteResumeImport: (id: string) => Promise<void>;
  saveCurrentResume: () => Promise<void>;
  loadVersions: () => Promise<void>;
  createVersion: (name?: string) => Promise<void>;
  renameVersion: (versionNo: number, name: string) => Promise<void>;
  deleteVersion: (versionNo: number) => Promise<void>;
  restoreVersion: (versionNo: number) => Promise<void>;
  goHome: () => void;
  dismissImportWarnings: (resumeId: string) => void;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  setEditorContent: (content: JSONContent) => void;
  setSplitRatio: (ratio: number) => void;
  setPreviewScale: (scale: number) => void;
  updateSettings: (settings: Partial<ResumeSettings>) => void;
  applyTemplate: (templateId: string, editorDocument: JSONContent) => Promise<void>;
  setSectionSemanticKind: (
    sectionId: string,
    semanticKind: import("../api/resumeContract").CanonicalResumeSection["semantic_kind"],
    source?: "model" | "user",
    confidence?: number | null,
  ) => void;
};

type SaveSnapshot = {
  activeResumeId: string;
  lockVersion: number;
  data: import("../api/resumeContract").CanonicalResumeDocument;
  style: import("../api/resumeContract").CanonicalResumePresentation;
  title: string;
  markdown: string;
  editorContent: JSONContent | string;
  settings: ResumeSettings;
  splitRatio: number;
  previewScale: number;
};

let saveQueue: Promise<void> = Promise.resolve();

function createImportIdempotencyKey(): string {
  const nativeUuid = globalThis.crypto?.randomUUID?.();
  if (nativeUuid) return nativeUuid;

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

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
  const canonicalEditor = resumeDocumentToEditorDocument(resume.data);
  let editorContent: JSONContent | string;
  const definition = resumePresentationTemplateDefinition(resume.style);
  editorContent = canonicalEditor && resume.layout_plan && definition
    ? composeEditorDocumentForLayoutPlan(canonicalEditor, resume.data, resume.layout_plan, definition)
    : canonicalEditor ?? renderResumeMarkdown(markdown);
  const semanticSettings = normalizeSettings(styleToEditorSettings(resume.style));
  return {
    activeResumeId: resume.id,
    lockVersion: resume.lock_version,
    data: resume.data,
    style: resume.style,
    title: resume.title,
    markdown,
    editorContent,
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
    preview: { data: resume.data, style: resume.style },
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
  activeImports: [],
  failedImports: [],
  versions: [],
  versionsLoading: false,
  versionOperationPending: false,
  importWarningsByResumeId: {},
  activeResumeId: null,
  lockVersion: 0,
  data: defaultCanonicalDocument,
  style: defaultCanonicalPresentation,
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
        set({
          authStatus: "guest",
          user: null,
          resumes: [],
          activeImports: [],
          failedImports: [],
          versions: [],
          importWarningsByResumeId: {},
          activeResumeId: null,
          lockVersion: 0,
        });
        return;
      }

      set({ authStatus: "authenticated", user });
      await get().listResumes();
    } catch (error) {
      set({ authStatus: "guest", user: null, error: (error as Error).message });
    }
  },

  login: async (email, password) => {
    const { user } = await api.login(email, password);
    set({ authStatus: "authenticated", user, error: null });
    await get().listResumes();
  },

  register: async (email, password) => {
    const { user } = await api.register(email, password);
    set({ authStatus: "authenticated", user, error: null });
    await get().listResumes();
  },

  loginWithWechat: async (user) => {
    set({ authStatus: "authenticated", user, error: null });
    await get().listResumes();
  },

  logout: async () => {
    await api.logout();
    set({
      authStatus: "guest",
      user: null,
      resumes: [],
      activeImports: [],
      failedImports: [],
      versions: [],
      versionOperationPending: false,
      importWarningsByResumeId: {},
      activeResumeId: null,
      lockVersion: 0,
      dirty: false,
      saveStatus: "idle",
    });
  },

  syncProfile: (profile) => {
    const current = get().user;
    if (!current) return;
    set({ user: { ...current, ...profile } });
  },

  listResumes: async () => {
    const overview = await api.getResumeOverview();
    set({
      resumes: overview.resumes,
      activeImports: overview.active_imports,
      failedImports: overview.failed_imports,
    });
  },

  createResume: async (title, templateId) => {
    const { resume } = await api.createResume({
      title,
      template_id: templateId,
    });
    const { resumes } = await api.listResumes();
    set({ resumes, versions: [], ...applyResume(resume) });
    return resume.id;
  },

  importResume: async (file, templateId, title) => {
    const idempotencyKey = createImportIdempotencyKey();
    const importFile = title === undefined ? file : buildNamedImportFile(file, title);
    try {
      const { import: importTask } = await api.importResume(
        importFile,
        templateId,
        idempotencyKey,
      );
      set((state) => ({
        activeImports: [
          importTask,
          ...state.activeImports.filter((item) => item.id !== importTask.id),
        ],
        failedImports: state.failedImports.filter((item) => item.id !== importTask.id),
      }));
      return importTask.id;
    } catch (error) {
      if (error instanceof Error && "payload" in error) {
        const payload = (error as { payload?: Record<string, unknown> | null }).payload;
        const importTask = payload?.import as ResumeImportSummary | undefined;
        if (importTask?.id) {
          set((state) => ({
            activeImports: state.activeImports.filter((item) => item.id !== importTask.id),
            failedImports: [
              importTask,
              ...state.failedImports.filter((item) => item.id !== importTask.id),
            ],
          }));
        }
      }
      throw error;
    }
  },

  pollResumeImport: async (id) => {
    const current = get().activeImports.find((item) => item.id === id);
    if (
      current?.upload_status !== "succeeded"
      || current.parse_status !== "processing"
    ) {
      return;
    }
    const { import: importTask } = await api.getResumeImport(id);
    if (importTask.parse_status === "processing") {
      set((state) => ({
        activeImports: state.activeImports.map((item) => (
          item.id === importTask.id ? importTask : item
        )),
      }));
      return;
    }
    if (importTask.parse_status === "failed" || importTask.upload_status === "failed") {
      set((state) => ({
        activeImports: state.activeImports.filter((item) => item.id !== importTask.id),
        failedImports: [
          importTask,
          ...state.failedImports.filter((item) => item.id !== importTask.id),
        ],
      }));
      return;
    }
    if (importTask.parse_status === "succeeded") {
      const overview = await api.getResumeOverview();
      set({
        resumes: overview.resumes,
        activeImports: overview.active_imports,
        failedImports: overview.failed_imports,
      });
    }
  },

  loadResume: async (id) => {
    const { resume } = await api.getResume(id);
    set({ versions: [], ...applyResume(resume) });
  },

  renameResume: async (id, title) => {
    const current = get().resumes.find((resume) => resume.id === id);
    if (!current) throw new Error("RESUME_NOT_FOUND");
    const { resume } = await api.updateResume(id, {
      title,
      base_lock_version: current.lock_version,
    });
    set((state) => {
      const resumes = mergeResumeSummary(state.resumes, resume);
      if (state.activeResumeId !== id) return { resumes };
      return {
        resumes,
        title: resume.title,
        lockVersion: resume.lock_version,
      };
    });
  },

  deleteResume: async (id) => {
    const { deleted } = await api.deleteResume(id);
    if (!deleted) throw new Error("RESUME_DELETE_FAILED");
    set((state) => {
      const importWarningsByResumeId = { ...state.importWarningsByResumeId };
      delete importWarningsByResumeId[id];
      return {
        resumes: state.resumes.filter((resume) => resume.id !== id),
        importWarningsByResumeId,
      };
    });

    if (get().activeResumeId === id) {
      set({ activeResumeId: null, versions: [], lockVersion: 0, dirty: false, saveStatus: "idle" });
    }
  },

  deleteResumeImport: async (id) => {
    const { deleted } = await api.deleteResumeImport(id);
    if (!deleted) throw new Error("RESUME_IMPORT_DELETE_FAILED");
    set((state) => ({
      failedImports: state.failedImports.filter((item) => item.id !== id),
    }));
  },

  saveCurrentResume: async () => {
    const requestedResumeId = get().activeResumeId;
    const queuedSave = saveQueue.then(async () => {
      const state = get();
      if (
        !state.activeResumeId
        || state.activeResumeId !== requestedResumeId
        || !state.dirty
        || state.versionOperationPending
      ) return;
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
        const nextData = typeof snapshot.editorContent === "string"
          ? snapshot.data
          : resumeDocumentFromEditorDocument(snapshot.editorContent, snapshot.data);
        let nextStyle = editorSettingsToStyle(snapshot.settings, snapshot.style);
        if (typeof snapshot.editorContent !== "string") {
          const avatar = editorDocumentUserAvatar(snapshot.editorContent);
          if (avatar) {
            nextStyle = withResumePresentationAvatarSize(nextStyle, avatar.size);
          }
        }
        const response = await api.updateResume(snapshot.activeResumeId, {
          title: snapshot.title,
          base_lock_version: snapshot.lockVersion,
          data: nextData,
          style: nextStyle,
        });
        const { resume } = response;
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

  createVersion: async (name) => {
    const resumeId = get().activeResumeId;
    if (!resumeId) return;
    try {
      const { version } = await api.createVersion(resumeId, name);
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

  renameVersion: async (versionNo, name) => {
    const resumeId = get().activeResumeId;
    if (!resumeId) return;
    try {
      const { version } = await api.renameVersion(resumeId, versionNo, name);
      if (get().activeResumeId === resumeId) {
        set((state) => ({
          versions: state.versions.map((item) => (
            item.version_no === version.version_no ? version : item
          )),
          error: null,
        }));
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
      await saveQueue;
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

  dismissImportWarnings: (resumeId) =>
    set((state) => {
      const importWarningsByResumeId = { ...state.importWarningsByResumeId };
      delete importWarningsByResumeId[resumeId];
      return { importWarningsByResumeId };
    }),

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
      const canonical = stripTemplateProjectionFromEditorDocument(editorContent, state.data);
      return {
        editorContent,
        markdown: editorDocumentToMarkdown(canonical),
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
  applyTemplate: async (templateId, editorDocument) => {
    let state = get();
    if (!state.activeResumeId) throw new Error("RESUME_NOT_FOUND");
    if (state.versionOperationPending) throw new Error("RESUME_TEMPLATE_APPLY_PENDING");
    const resumeId = state.activeResumeId;
    const operationVersion = state.editVersion;
    const operationId = ++templateOperationSequence;
    const nextData = resumeDocumentFromEditorDocument(editorDocument, state.data);
    set({ saveStatus: "saving", versionOperationPending: true, error: null });
    try {
      const response = await api.applyResumeTemplate(resumeId, {
        template_id: templateId,
        base_lock_version: state.lockVersion,
        title: state.title,
        data: nextData,
      });
      const { resume } = response;
      state = get();
      if (operationId !== templateOperationSequence) return;
      if (state.activeResumeId !== resumeId) {
        set({ saveStatus: "idle", versionOperationPending: false });
        return;
      }
      if (state.editVersion !== operationVersion) {
        const latestData = typeof state.editorContent === "string"
          ? state.data
          : resumeDocumentFromEditorDocument(state.editorContent, state.data);
        const canonical = typeof state.editorContent === "string"
          ? resumeDocumentToEditorDocument(latestData)
          : stripTemplateProjectionFromEditorDocument(state.editorContent, latestData);
        const latestRecord = {
          ...resume,
          title: state.title,
          data: latestData,
        };
        const latestEditor = canonical && resume.layout_plan && resumePresentationTemplateDefinition(resume.style)
            ? composeEditorDocumentForLayoutPlan(
              canonical,
              latestData,
              resume.layout_plan,
              resumePresentationTemplateDefinition(resume.style) as NonNullable<ReturnType<typeof resumePresentationTemplateDefinition>>,
            )
            : canonical ?? state.editorContent;
        set({
          resumes: mergeResumeSummary(state.resumes, latestRecord),
          lockVersion: resume.lock_version,
          data: latestData,
          style: resume.style,
          editorContent: latestEditor,
          settings: normalizeSettings(styleToEditorSettings(resume.style)),
          dirty: true,
          saveStatus: "idle",
          versionOperationPending: false,
          error: null,
        });
        return;
      }
      set({
        resumes: mergeResumeSummary(state.resumes, resume),
        ...applyResume(resume, state),
        versionOperationPending: false,
      });
    } catch (error) {
      state = get();
      if (operationId !== templateOperationSequence) throw error;
      // Do not attach an obsolete request failure to another resume, but always
      // release the global operation lock owned by this request.
      set(state.activeResumeId === resumeId && state.editVersion === operationVersion
        ? { saveStatus: "error", versionOperationPending: false, error: (error as Error).message }
        : { saveStatus: "idle", versionOperationPending: false });
      throw error;
    }
  },
  setSectionSemanticKind: (sectionId, semanticKind, source = "user", confidence = null) =>
    set((state) => {
      return {
        data: {
          ...state.data,
          sections: state.data.sections.map((section) => (
            section.node_id === sectionId
              ? {
                ...section,
                semantic_kind: semanticKind,
              }
              : section
          )),
        },
        dirty: true,
        editVersion: state.editVersion + 1,
        saveStatus: "idle" as SaveStatus,
      };
    }),
}));
