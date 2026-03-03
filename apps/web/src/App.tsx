import { useState } from "react";
import { GeneratePage } from "./pages/GeneratePage";
import { JobsPage } from "./pages/JobsPage";
import { SettingsPage } from "./pages/SettingsPage";

type TabId = "generate" | "jobs" | "settings";

const TAB_LABEL: Record<TabId, string> = {
  generate: "Generate",
  jobs: "Jobs",
  settings: "Settings"
};

export default function App() {
  const [tab, setTab] = useState<TabId>("generate");

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>voice over video generator</h1>
        <nav>
          {(Object.keys(TAB_LABEL) as TabId[]).map((tabId) => (
            <button
              key={tabId}
              className={tab === tabId ? "tab active" : "tab"}
              onClick={() => setTab(tabId)}
            >
              {TAB_LABEL[tabId]}
            </button>
          ))}
        </nav>
      </header>
      {tab === "generate" && <GeneratePage />}
      {tab === "jobs" && <JobsPage />}
      {tab === "settings" && <SettingsPage />}
    </main>
  );
}
