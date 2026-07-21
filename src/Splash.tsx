import { useEffect, useState } from "react";

declare global {
  interface Window {
    zatgoBenchDesktop?: {
      getBenchUrl: () => Promise<string>;
      getBenchWebRoot: () => Promise<string>;
      getAppVersion: () => Promise<string>;
    };
  }
}

export function Splash() {
  const [url, setUrl] = useState("http://127.0.0.1:3008");
  const [root, setRoot] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
    const api = window.zatgoBenchDesktop;
    if (!api) return;
    void api.getBenchUrl().then(setUrl);
    void api.getBenchWebRoot().then(setRoot);
    void api.getAppVersion().then(setVersion);
  }, []);

  return (
    <main className="splash">
      <p className="brand">ZatGo</p>
      <h1>Bench Manager</h1>
      <p className="status">Starting local ops console…</p>
      <p className="meta">
        Loading <code>{url}</code>
      </p>
      {root ? (
        <p className="meta">
          Web root <code>{root}</code>
        </p>
      ) : null}
      {version ? <p className="meta">v{version}</p> : null}
    </main>
  );
}
