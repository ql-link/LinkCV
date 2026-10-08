import { installCryptoRandomUuid } from "@/utils/randomUuid";
import { installDemoStorage } from "./isolation";

// Imported first by main.tsx: ES modules evaluate in import order, so storage is
// isolated before any business module reads localStorage at load time.
installDemoStorage();
installCryptoRandomUuid();
