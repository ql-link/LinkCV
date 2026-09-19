const c = require("../../utils/career");
// Figma sizes 14 / 36 / 44 / 48 / 56 all use a 25% corner and 44% initial.
const INITIAL_RATIO = 0.44;
const INITIAL_MIN = 8;
Component({
  properties: {
    name: { type: String, value: "" },
    logo: { type: String, value: "" },
    color: { type: String, value: "" },
    size: { type: Number, value: 36 },
  },
  data: { src: "", initial: "企", style: "" },
  observers: {
    "name, logo, color, size"() {
      if (this._logo !== this.properties.logo) {
        this._logo = this.properties.logo;
        this._failed = false;
      }
      this.render();
    },
  },
  methods: {
    render() {
      const size = Number(this.properties.size) || 36;
      const fontSize = Math.max(INITIAL_MIN, Math.round(size * INITIAL_RATIO));
      this.setData({
        // A broken remote image falls back to the initial and stays there.
        src: this._failed ? "" : c.logoSource(this.properties.logo),
        initial: c.logoInitial(this.properties.name),
        style: `width:${size}px;height:${size}px;border-radius:${Math.round(size / 4)}px;background:${c.logoBackground(this.properties.color)};font-size:${fontSize}px`,
      });
    },
    handleError() {
      this._failed = true;
      this.setData({ src: "" });
    },
  },
});
