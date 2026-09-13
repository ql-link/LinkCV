// Lucide-style line icons shared by navigation, stages and status feedback.
const paths = {
  calendar:
    '<path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a20 20 0 0 0 18 0M12 11v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  cancel: '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8m0-8-8 8"/>',
  offer:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  screening: '<path d="M4 5h16M7 10h10m-7 5h4m-2 0v5"/>',
  assessment:
    '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m8 13 3 3 5-6"/>',
  written_test:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8m-8 4h5"/>',
  ai_interview:
    '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6M1 11v5m22-5v5"/>',
  interview:
    '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 3a4 4 0 0 1 0 8m3 10v-2a7 7 0 0 0-3-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8m-8 4h8"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
};
const colors = {
  muted: "#6f7a8c",
  accent: "#145ed6",
  success: "#267a4d",
  warning: "#9a5b13",
  offer: "#9a6a00",
  danger: "#c43b3b",
  neutral: "#6f7a8c",
  default: "#3f4752",
};
Component({
  properties: {
    design: { type: Boolean, value: false },
    name: { type: String, value: "calendar" },
    tone: { type: String, value: "default" },
    size: { type: Number, value: 36 },
  },
  data: { src: "" },
  observers: {
    "name,tone,design": function (name, tone, design) {
      if ((name === 'calendar' && tone === 'accent') || (name === 'briefcase' && tone === 'muted')) {
        this.setData({src: '/assets/career/' + name + '-' + tone + '.svg'});
        return;
      }
      if ((design || name === "ai_interview") && ["assessment", "written_test", "ai_interview", "interview", "offer"].includes(name)) {
        this.setData({src: `/assets/career/${name}.svg`});
        return;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${colors[tone] || colors.default}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.clock}</svg>`;
      this.setData({ src: `data:image/svg+xml,${encodeURIComponent(svg)}` });
    },
  },
});
