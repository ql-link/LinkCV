import { create } from "zustand";
import { api, ResumeRecord, ResumeSummary, User } from "../api/client";
import { defaultResumeMarkdown } from "../parser/defaultResume";

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

type AuthStatus = "checking" | "guest" | "authenticated";
type SaveStatus = "idle" | "saving" | "saved" | "error";

type ResumeState = {
  authStatus: AuthStatus;
  user: User | null;
  resumes: ResumeSummary[];
  activeResumeId: string | null;
  title: string;
  markdown: string;
  splitRatio: number;
  previewScale: number;
  settings: ResumeSettings;
  dirty: boolean;
  saveStatus: SaveStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  listResumes: () => Promise<void>;
  createResume: (title?: string) => Promise<void>;
  loadResume: (id: string) => Promise<void>;
  deleteResume: (id: string) => Promise<void>;
  saveCurrentResume: () => Promise<void>;
  goHome: () => void;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  setSplitRatio: (ratio: number) => void;
  setPreviewScale: (scale: number) => void;
  updateSettings: (settings: Partial<ResumeSettings>) => void;
};

export const defaultSettings: ResumeSettings = {
  fontFamily: "Noto Serif SC, Source Han Serif SC, SimSun, serif",
  fontSize: 10.5,
  lineHeight: 1.32,
  pageMargin: 16,
  verticalPageMargin: 16,
  theme: "classic",
  smartOnePage: false,
  showSource: false,
};

function applyResume(resume: ResumeRecord) {
  return {
    activeResumeId: resume.id,
    title: resume.title,
    markdown: resume.markdown,
    settings: { ...defaultSettings, ...resume.settings, showSource: false },
    splitRatio: resume.splitRatio,
    previewScale: resume.previewScale,
    dirty: false,
    saveStatus: "saved" as SaveStatus,
    error: null,
  };
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  authStatus: "checking",
  user: null,
  resumes: [],
  activeResumeId: null,
  title: "张三-后端开发实习生",
  markdown: defaultResumeMarkdown,
  splitRatio: 0.4,
  previewScale: 1,
  settings: defaultSettings,
  dirty: false,
  saveStatus: "idle",
  error: null,

  hydrate: async () => {
    try {
      const { user } = await api.me();
      if (!user) {
        set({ authStatus: "guest", user: null, resumes: [], activeResumeId: null });
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
      activeResumeId: null,
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
      markdown: defaultResumeMarkdown,
      settings: defaultSettings,
      splitRatio: 0.4,
      previewScale: 1,
    });
    const { resumes } = await api.listResumes();
    set({ resumes, ...applyResume(resume) });
  },

  loadResume: async (id) => {
    const { resume } = await api.getResume(id);
    set(applyResume(resume));
  },

  deleteResume: async (id) => {
    await api.deleteResume(id);
    const { resumes } = await api.listResumes();
    set({ resumes });

    if (get().activeResumeId === id) {
      set({ activeResumeId: null, dirty: false, saveStatus: "idle" });
    }
  },

  saveCurrentResume: async () => {
    const state = get();
    if (!state.activeResumeId) return;

    set({ saveStatus: "saving", error: null });

    try {
      const { resume } = await api.updateResume(state.activeResumeId, {
        title: state.title,
        markdown: state.markdown,
        settings: { ...state.settings, showSource: false },
        splitRatio: state.splitRatio,
        previewScale: state.previewScale,
      });
      const { resumes } = await api.listResumes();
      set({ resumes, ...applyResume(resume) });
    } catch (error) {
      set({ saveStatus: "error", error: (error as Error).message });
    }
  },

  goHome: () => set({ activeResumeId: null }),

  setTitle: (title) => set({ title, dirty: true, saveStatus: "idle" }),
  setMarkdown: (markdown) => set({ markdown, dirty: true, saveStatus: "idle" }),
  setSplitRatio: (splitRatio) => set({ splitRatio, dirty: true, saveStatus: "idle" }),
  setPreviewScale: (previewScale) => set({ previewScale, dirty: true, saveStatus: "idle" }),
  updateSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings },
      dirty: true,
      saveStatus: "idle",
    })),
}));
