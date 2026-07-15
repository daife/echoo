import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AppProviders } from "./app/providers/AppProviders";
import "./styles/global.css";
import { AdminPage } from "./pages/admin/AdminPage";

const root =
  window.location.pathname.replace(/\/+$/, "") === "/admin" ? (
    <AdminPage />
  ) : (
    <AppProviders>
      <App />
    </AppProviders>
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{root}</StrictMode>,
);
