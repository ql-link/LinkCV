import { extractBossJob } from "../src/extractor/boss";
import { CAPTURE_MESSAGE } from "../src/contracts";

export default defineContentScript({
  matches: [
    "https://zhipin.com/job_detail/*",
    "https://www.zhipin.com/job_detail/*",
    "https://m.zhipin.com/job_detail/*",
    "https://zhipin.com/web/geek/jobs*",
    "https://www.zhipin.com/web/geek/jobs*",
    "https://m.zhipin.com/web/geek/jobs*",
  ],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        (message as { type?: unknown }).type !== CAPTURE_MESSAGE
      ) {
        return undefined;
      }
      return Promise.resolve(extractBossJob(document, window.location.href));
    });
  },
});
