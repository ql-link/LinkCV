import { DemoWorkspace } from "./DemoWorkspace";
import { installDemoRuntime } from "./DemoRuntime";

installDemoRuntime();

export function DemoApp() {
  return <DemoWorkspace />;
}
