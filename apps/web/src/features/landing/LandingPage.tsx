import { useRef, useState } from "react";
import { LanguageProvider } from "./locales/LanguageContext";
import { Chaos, Marquee } from "./sections/Chaos";
import { EditorSection } from "./sections/EditorSection";
import { FAQ } from "./sections/FAQ";
import { Features } from "./sections/Features";
import { Footer } from "./sections/Footer";
import { Hero } from "./sections/Hero";
import { JDSection } from "./sections/JDSection";
import { Nav } from "./sections/Nav";
import { Philosophy } from "./sections/Philosophy";
import { VersionExport } from "./sections/VersionExport";
import { Workflow } from "./sections/Workflow";
import "./landing.css";

type LandingPageProps = {
  onStart: () => void;
  onLogin: () => void;
};

export function LandingPage({ onStart, onLogin }: LandingPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("linkcv-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("linkcv-theme", next);
      } catch {
        // localStorage may be unavailable in privacy-restricted contexts.
      }
      return next;
    });
  };

  return (
    <LanguageProvider>
      <div ref={pageRef} className={`marketing-landing ${theme === "dark" ? "dark" : ""}`}>
        <Nav
          scrollContainerRef={pageRef}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogin={onLogin}
        />
        <main>
          <Hero onStart={onStart} scrollContainerRef={pageRef} />
          <Marquee />
          <Chaos />
          <Features />
          <EditorSection />
          <VersionExport />
          <JDSection />
          <Workflow />
          <Philosophy />
          <FAQ />
        </main>
        <Footer onStart={onStart} />
      </div>
    </LanguageProvider>
  );
}
