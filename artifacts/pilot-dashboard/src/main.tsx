import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { startOutboxWorker } from "./lib/offlineQueue";

startOutboxWorker();
createRoot(document.getElementById("root")!).render(<App />);
