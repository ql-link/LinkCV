import { useState } from "react";
import { navigateTo } from "../../routing";
import { V3Shell } from "../../v3/Shell";
import { HomePage } from "./HomePage";

// /resumes/new：Figma 02.1a 里新建是弹窗，所以这里渲染「02.1 列表底图 + 新建弹窗」。
// ?mode=import 打开导入弹窗（02.1b），?template=<id> 预选模板；关闭弹窗回到 /resumes。
export function ResumeCreatePage() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const importMode = params.get("mode") === "import";
  const backToList = () => navigateTo("/resumes", { replace: true });
  return (
    <V3Shell active="resumes">
      <HomePage
        initialCreateOpen={!importMode}
        initialImportOpen={importMode}
        initialTemplateId={params.get("template")}
        onCreateClose={backToList}
        onImportClose={backToList}
      />
    </V3Shell>
  );
}
